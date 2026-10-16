import { PgExplorer } from "./explorer";
import { PgWorkspace } from "./workspace";
import {
  clearFailures,
  getFailures,
} from "../../features/persistence/model/diagnostics";

/**
 * The two states the explorer could not hold: no current workspace, and a
 * config naming workspaces that are not on disk.
 *
 * Both are ordinary -- one is a step inside every delete, the other is what
 * the recovery path exists for -- and both went through
 * `getRequiredCurrentWorkspacePath`, which treats them as faults.
 *
 * `deleteWorkspace` removes the workspace from state and *then* moves to
 * another one, so for the length of that call the explorer holds workspaces
 * with none of them current. Upstream survived it by accident: the current
 * pointer was a name, so it went on naming the deleted workspace and the
 * metadata save bailed out of its own accord. The pointer is an id now and
 * resolves through the list, so the same window answers "no current
 * workspace" -- and `saveMeta`, the first thing `switchWorkspace` does,
 * demanded one.
 *
 * It surfaced through sign-out, which removes every workspace in a loop: the
 * first delete threw half-way, leaving workspaces on the list with nothing
 * current, and the explorer sidebar renders that state by asking for the
 * current workspace's path -- so the whole app fell into the error boundary
 * with "Current workspace not found".
 */

const files = (name: string): Array<[string, string]> => [
  [`/${name}/src/lib.rs`, "declare_id!();"],
];

const reset = async () => {
  (
    PgExplorer.fs as unknown as { __files: Map<string, string> }
  ).__files.clear();

  // The explorer keeps its workspaces in a module static, so a test that means
  // "a fresh browser" has to say so
  const statics = PgExplorer as unknown as {
    _workspace: unknown;
    _initializedWorkspaceName: unknown;
  };
  statics._workspace = null;
  statics._initializedWorkspaceName = null;

  await PgExplorer.init();
};

describe("a config that names workspaces the filesystem does not have", () => {
  beforeEach(reset);

  it("resets rather than looping, and finishes initializing", async () => {
    // What `_initCurrentWorkspace` exists to recover: file data lost while the
    // config survived -- a partial eviction, or a delete that removed the
    // files and then failed before saving. Its reset is `new PgWorkspace()`,
    // which returned the shared `DEFAULT` -- by then holding the very
    // workspaces it was meant to clear, so it re-saved them and re-entered
    // itself forever. `init` never resolved, so the main panel sat on its
    // spinner, and nothing threw for a boundary to catch.
    const stored = (
      PgExplorer.fs as unknown as { __files: Map<string, string> }
    ).__files;
    stored.set(
      PgWorkspace.WORKSPACES_CONFIG_PATH,
      JSON.stringify({
        workspaces: [{ id: "w1", name: "alpha" }],
        currentId: "w1",
      })
    );
    (PgExplorer as unknown as { _workspace: unknown })._workspace = null;

    // Raced rather than awaited: a regression here does not fail, it hangs,
    // and a hung suite says far less than a failed assertion
    const settled = await Promise.race([
      PgExplorer.init().then(() => "initialized" as const),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 1000)),
    ]);

    expect(settled).toBe("initialized");
    expect(PgExplorer.allWorkspaceNames).toEqual([]);
  });
});

describe("deleting the current workspace", () => {
  beforeEach(reset);

  it("moves to another one rather than throwing", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    await PgExplorer.createWorkspace("beta", { files: files("beta") });
    expect(PgExplorer.currentWorkspaceName).toBe("beta");

    await PgExplorer.deleteWorkspace("beta");

    expect(PgExplorer.allWorkspaceNames).toEqual(["alpha"]);
    expect(PgExplorer.currentWorkspaceName).toBe("alpha");
  });

  it("leaves nothing current when it was the last one", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });

    await PgExplorer.deleteWorkspace("alpha");

    expect(PgExplorer.allWorkspaceNames).toEqual([]);
    expect(PgExplorer.currentWorkspaceName).toBeUndefined();
  });

  it("can be repeated until there are none left", async () => {
    // Sign-out's release, which is where this was found: every workspace goes
    // in one loop, and the second delete only works if the first left a valid
    // current workspace behind
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    await PgExplorer.createWorkspace("beta", { files: files("beta") });
    await PgExplorer.createWorkspace("gamma", { files: files("gamma") });

    for (const name of [...PgExplorer.allWorkspaceNames!]) {
      await PgExplorer.deleteWorkspace(name);
    }

    expect(PgExplorer.allWorkspaceNames).toEqual([]);
  });
});

describe("init calls that overlap", () => {
  beforeEach(reset);

  // Strict mode mounts the router effect twice, which starts two route
  // handlers, and each one awaits `PgExplorer.init()`. Run side by side, both
  // create the workspace directories and the second fails with EEXIST.
  it("run one after another", async () => {
    const statics = PgExplorer as unknown as {
      _init: (params?: unknown) => Promise<void>;
    };
    const real = statics._init.bind(PgExplorer);
    const order: string[] = [];
    vi.spyOn(statics, "_init").mockImplementation(async (params) => {
      order.push("start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      await real(params);
      order.push("end");
    });

    await Promise.all([PgExplorer.init(), PgExplorer.init()]);

    expect(order).toEqual(["start", "end", "start", "end"]);
  });

  it("do not stop the next one when the first fails", async () => {
    const statics = PgExplorer as unknown as {
      _init: (params?: unknown) => Promise<void>;
    };
    vi.spyOn(statics, "_init")
      .mockRejectedValueOnce(new Error("first failed"))
      .mockResolvedValueOnce(undefined);

    const first = PgExplorer.init();
    const second = PgExplorer.init();

    await expect(first).rejects.toThrow("first failed");
    await expect(second).resolves.toBeUndefined();
  });

  afterEach(() => vi.restoreAllMocks());
});

/**
 * Tabs of one browser share the workspaces config, and each used to read it
 * once at load. `refreshWorkspaces` is how a tab catches up with a neighbour
 * that created, deleted or renamed a workspace since -- without taking the
 * neighbour's current workspace as its own.
 */

const stored = () =>
  (PgExplorer.fs as unknown as { __files: Map<string, string> }).__files;

const readConfig = () =>
  JSON.parse(stored().get(PgWorkspace.WORKSPACES_CONFIG_PATH)!) as {
    workspaces: Array<{ id: string; name: string }>;
    currentId?: string;
  };

/** What a neighbour's save leaves in the store */
const writeConfig = (config: {
  workspaces: Array<{ id: string; name: string }>;
  currentId?: string;
}) => stored().set(PgWorkspace.WORKSPACES_CONFIG_PATH, JSON.stringify(config));

describe("PgExplorer.refreshWorkspaces", () => {
  beforeEach(async () => {
    await reset();
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    await PgExplorer.createWorkspace("beta", { files: files("beta") });
    clearFailures();
  });
  afterEach(() => vi.restoreAllMocks());

  it("takes a neighbour's list and keeps this tab's current", async () => {
    const alpha = PgExplorer.workspaceIdOf("alpha")!;
    const beta = PgExplorer.workspaceIdOf("beta")!;
    writeConfig({
      workspaces: [
        { id: alpha, name: "alpha" },
        { id: beta, name: "beta" },
        { id: "g1", name: "gamma" },
      ],
      // The neighbour saved last, with its own current workspace
      currentId: "g1",
    });

    await PgExplorer.refreshWorkspaces();

    expect(PgExplorer.allWorkspaceNames).toEqual(["alpha", "beta", "gamma"]);
    expect(PgExplorer.currentWorkspaceId).toBe(beta);
    expect(PgExplorer.currentWorkspaceName).toBe("beta");
  });

  it("follows the current workspace through a rename elsewhere", async () => {
    const alpha = PgExplorer.workspaceIdOf("alpha")!;
    const beta = PgExplorer.workspaceIdOf("beta")!;
    writeConfig({
      workspaces: [
        { id: alpha, name: "alpha" },
        { id: beta, name: "renamed" },
      ],
      currentId: alpha,
    });

    await PgExplorer.refreshWorkspaces();

    expect(PgExplorer.currentWorkspaceName).toBe("renamed");
  });

  it("drops a workspace deleted elsewhere", async () => {
    const alpha = PgExplorer.workspaceIdOf("alpha")!;
    writeConfig({
      workspaces: [{ id: alpha, name: "alpha" }],
      currentId: alpha,
    });

    await PgExplorer.refreshWorkspaces();

    expect(PgExplorer.allWorkspaceNames).toEqual(["alpha"]);
    // Deleted while this tab had it open: nothing is current any more, which
    // `reloadCurrentFromDisk` answers by moving on
    expect(PgExplorer.currentWorkspaceName).toBeUndefined();
  });

  it("writes nothing", async () => {
    const alpha = PgExplorer.workspaceIdOf("alpha")!;
    const config = {
      workspaces: [{ id: alpha, name: "alpha" }],
      currentId: "x",
    };
    writeConfig(config);

    await PgExplorer.refreshWorkspaces();

    expect(readConfig()).toEqual(config);
  });

  it("keeps the list in memory when the config cannot be read", async () => {
    // A missing file reads as the empty default elsewhere. Taken here, that
    // would empty this tab's list, and its next save would empty the store's.
    stored().delete(PgWorkspace.WORKSPACES_CONFIG_PATH);

    // Nothing there is nothing to take, so nothing is owed either
    expect(await PgExplorer.refreshWorkspaces()).toBe(true);

    expect(PgExplorer.allWorkspaceNames).toEqual(["alpha", "beta"]);
    expect(PgExplorer.currentWorkspaceName).toBe("beta");
  });

  it("says so when the config is there and cannot be parsed", async () => {
    // Caught half-written, or corrupted. Read as fresh, it told the reload
    // there was nothing of a neighbour's to catch up with, when the store
    // may hold exactly that.
    stored().set(PgWorkspace.WORKSPACES_CONFIG_PATH, '{"workspaces":[');

    expect(await PgExplorer.refreshWorkspaces()).toBe(false);

    expect(PgExplorer.allWorkspaceNames).toEqual(["alpha", "beta"]);
    expect(getFailures()).toEqual([
      expect.objectContaining({ what: "refresh workspaces" }),
    ]);
  });

  it("does nothing in a temporary workspace", async () => {
    await PgExplorer.init({ files: [["/src/lib.rs", "t"]] });

    await PgExplorer.refreshWorkspaces();

    expect(PgExplorer.allWorkspaceNames).toBeUndefined();
  });

  it("leaves this tab's own create alone while it is in flight", async () => {
    // `createWorkspace` adds the entry to memory at once and saves it only
    // inside the switch, after awaits. A refresh in between used to take the
    // store's list -- without the new workspace -- and leave the files with
    // nothing pointing at them.
    const creating = PgExplorer.createWorkspace("gamma", {
      files: files("gamma"),
    });
    // Said so, too: nothing was taken, and the caller has to know
    expect(await PgExplorer.refreshWorkspaces()).toBe(false);
    await creating;

    expect(PgExplorer.allWorkspaceNames).toEqual(["alpha", "beta", "gamma"]);
    expect(PgExplorer.currentWorkspaceName).toBe("gamma");
    expect(readConfig().workspaces.map((w) => w.name)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("refreshes again once that save has landed", async () => {
    await PgExplorer.createWorkspace("gamma", { files: files("gamma") });
    writeConfig({ workspaces: [], currentId: readConfig().currentId });

    await PgExplorer.refreshWorkspaces();

    expect(PgExplorer.allWorkspaceNames).toEqual([]);
  });

  it("leaves a save that lands during the read alone", async () => {
    // A rename lands while the config is being read, and a second one has
    // begun -- in memory, not yet saved -- by the time the read returns. The
    // list in memory then looks untouched since the read started, but what
    // the store holds is the first rename, and taking it would undo the
    // second. Driven through the list and its save directly: the in-memory
    // filesystem cannot move a workspace's directory.
    const explorer = PgExplorer as unknown as {
      _workspace: PgWorkspace;
      _saveWorkspaces: () => Promise<void>;
    };
    const read = PgExplorer.fs.readToJSON.bind(PgExplorer.fs);
    vi.spyOn(PgExplorer.fs, "readToJSON").mockImplementationOnce(
      async (path: string) => {
        explorer._workspace.rename("renamed");
        await explorer._saveWorkspaces();
        const config = await read(path);
        explorer._workspace.rename("beta");
        return config;
      }
    );

    expect(await PgExplorer.refreshWorkspaces()).toBe(false);
    expect(PgExplorer.currentWorkspaceName).toBe("beta");
  });

  it("does not record a save that failed as saved", async () => {
    // Recorded before the write, a failed one made this tab's own create
    // look like the store's list at the next refresh -- which then took the
    // store's, without it
    const write = PgExplorer.fs.writeFile.bind(PgExplorer.fs);
    vi.spyOn(PgExplorer.fs, "writeFile").mockImplementation(
      async (path: string, data: string) => {
        if (path === PgWorkspace.WORKSPACES_CONFIG_PATH) {
          throw new Error("QuotaExceededError");
        }
        await write(path, data);
      }
    );
    await expect(
      PgExplorer.createWorkspace("gamma", { files: files("gamma") })
    ).rejects.toThrow("QuotaExceeded");

    expect(await PgExplorer.refreshWorkspaces()).toBe(false);
    expect(PgExplorer.allWorkspaceNames).toEqual(["alpha", "beta", "gamma"]);
  });
});

/**
 * Sync renames a workspace the user may not be in: a project renamed on
 * another device is renamed here when this device takes that device's copy,
 * and it need not be the open one. Switching into it to rename it would pull
 * the user out of whatever they are working on.
 */
describe("renaming a workspace that is not the current one", () => {
  beforeEach(reset);

  /** Every rename event, with what it carried */
  const renames = () => {
    const seen: unknown[] = [];
    const sub = PgExplorer.onDidRenameWorkspace((renamed) =>
      seen.push(renamed)
    );
    return { seen, dispose: () => sub.dispose() };
  };

  it("announces a rename the user asked for, with the workspace's id", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    const alphaId = PgExplorer.currentWorkspaceId;
    await PgExplorer.createWorkspace("beta", { files: files("beta") });
    const events = renames();

    await PgExplorer.renameWorkspace("gamma", {
      from: "alpha",
      announce: true,
    });
    events.dispose();

    expect(events.seen).toEqual([{ id: alphaId }]);
  });

  it("does not announce a rename sync made", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    await PgExplorer.createWorkspace("beta", { files: files("beta") });
    const events = renames();

    await PgExplorer.renameWorkspace("gamma", { from: "alpha" });
    events.dispose();

    expect(events.seen).toEqual([]);
  });

  it("renames it on disk and in the list, and stays where it was", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    const alphaId = PgExplorer.currentWorkspaceId;
    await PgExplorer.createWorkspace("beta", { files: files("beta") });

    await PgExplorer.renameWorkspace("gamma", { from: "alpha" });

    expect(PgExplorer.currentWorkspaceName).toBe("beta");
    expect([...PgExplorer.allWorkspaceNames!].sort()).toEqual([
      "beta",
      "gamma",
    ]);
    expect(PgExplorer.workspaceIdOf("gamma")).toBe(alphaId);
    expect(stored().get("/gamma/src/lib.rs")).toBe("declare_id!();");
    expect(stored().has("/alpha/src/lib.rs")).toBe(false);
    expect(
      readConfig()
        .workspaces.map((w) => w.name)
        .sort()
    ).toEqual(["beta", "gamma"]);
  });

  it("does not announce it as a rename of the current one", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    await PgExplorer.createWorkspace("beta", { files: files("beta") });
    const renamed = vi.fn();
    const { dispose } = PgExplorer.onDidRenameWorkspace(renamed);

    try {
      await PgExplorer.renameWorkspace("gamma", { from: "alpha" });
    } finally {
      dispose();
    }

    expect(renamed).not.toHaveBeenCalled();
  });

  it("renames the current one as before when `from` names it", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });

    await PgExplorer.renameWorkspace("gamma", { from: "alpha" });

    expect(PgExplorer.currentWorkspaceName).toBe("gamma");
    expect(PgExplorer.allWorkspaceNames).toEqual(["gamma"]);
  });

  it("refuses a name another workspace holds", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    await PgExplorer.createWorkspace("beta", { files: files("beta") });

    await expect(
      PgExplorer.renameWorkspace("beta", { from: "alpha" })
    ).rejects.toThrow(PgWorkspace.errors.ALREADY_EXISTS);
    expect(stored().get("/alpha/src/lib.rs")).toBe("declare_id!();");
  });

  it("refuses a workspace that does not exist", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });

    await expect(
      PgExplorer.renameWorkspace("gamma", { from: "nope" })
    ).rejects.toThrow(PgWorkspace.errors.NOT_FOUND);
  });

  it("puts the directory and the list back when the save fails", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    const alphaId = PgExplorer.currentWorkspaceId;
    await PgExplorer.createWorkspace("beta", { files: files("beta") });
    const writeFile = PgExplorer.fs.writeFile.bind(PgExplorer.fs);
    const failing = vi
      .spyOn(PgExplorer.fs, "writeFile")
      .mockImplementationOnce(async () => {
        throw new Error("quota");
      })
      .mockImplementation(writeFile);

    try {
      await expect(
        PgExplorer.renameWorkspace("gamma", { from: "alpha" })
      ).rejects.toThrow("quota");
    } finally {
      failing.mockRestore();
    }

    expect(PgExplorer.workspaceNameOf(alphaId!)).toBe("alpha");
    expect(stored().get("/alpha/src/lib.rs")).toBe("declare_id!();");
    expect(stored().has("/gamma/src/lib.rs")).toBe(false);
    expect(
      readConfig()
        .workspaces.map((w) => w.name)
        .sort()
    ).toEqual(["alpha", "beta"]);
  });
});

describe("importing a workspace under a name already in use", () => {
  beforeEach(reset);

  it("refuses before writing a file into the holder's directory", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });

    await expect(
      PgExplorer.importWorkspace("alpha", {
        id: "p3",
        files: { "src/lib.rs": "another project" },
      })
    ).rejects.toThrow(PgWorkspace.errors.ALREADY_EXISTS);
    expect(stored().get("/alpha/src/lib.rs")).toBe("declare_id!();");
    expect(PgExplorer.workspaceNameOf("p3")).toBeUndefined();
  });
});
