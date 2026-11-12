import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import nodePath from "path";

import {
  clearFailures,
  getFailures,
} from "../../features/persistence/model/diagnostics";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "../../shared/lib/telemetry";
import { requireFor } from "../../test-utils/require-for";
import { PgExplorer } from "./explorer";
import { PgWorkspace } from "./workspace";

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

    for (const name of Array.from(
      requireFor("the workspace names")(PgExplorer.allWorkspaceNames)
    )) {
      await PgExplorer.deleteWorkspace(name);
    }

    expect(PgExplorer.allWorkspaceNames).toEqual([]);
  });
});

describe("creating a workspace while another is open", () => {
  beforeEach(reset);
  afterEach(() => vi.restoreAllMocks());

  // `create` makes the new workspace current before `switchWorkspace` saves
  // the old one's metadata, and that save found files outside the current
  // workspace, took the state as invalid and saved nothing: entering a
  // tutorial the first time (its workspace is made then) brought the project
  // back at line 1 (HOO-2731)
  it("keeps the open file's cursor and top line", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    const file = requireFor("the open file")(PgExplorer.currentFilePath);
    const position = { cursor: { from: 7, to: 9 }, topLineNumber: 3 };
    PgExplorer.saveEditorPosition(file, position);

    await PgExplorer.createWorkspace("beta", { files: files("beta") });
    await PgExplorer.switchWorkspace("alpha");

    expect(PgExplorer.getEditorPosition(file)).toEqual(position);
  });

  it("still creates the workspace when saving the one left fails", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    clearFailures();
    const write = PgExplorer.fs.writeFile.bind(PgExplorer.fs);
    vi.spyOn(PgExplorer.fs, "writeFile").mockImplementation(
      async (path: string, data: string) => {
        if (path.startsWith("/alpha/") && path.endsWith("metadata.json")) {
          throw new Error("QuotaExceededError");
        }
        await write(path, data);
      }
    );

    await PgExplorer.createWorkspace("beta", { files: files("beta") });

    expect(PgExplorer.currentWorkspaceName).toBe("beta");
    expect(getFailures().map((f) => f.what)).toContain(
      "save the metadata of the workspace left"
    );
  });
});

describe("PgExplorer.saveEditorPosition", () => {
  beforeEach(reset);

  // The editor saves its position every second; a workspace being re-read
  // (Start in a tutorial) has emptied the file map, and the save threw
  // "reading 'meta'" (HOO-2585)
  it("skips a file the open workspace does not hold", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    const position = { cursor: { from: 0, to: 0 }, topLineNumber: 1 };

    expect(() =>
      PgExplorer.saveEditorPosition("src/gone.rs", position)
    ).not.toThrow();
  });

  it("keeps the position of a file it holds", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    const path = requireFor("a file of alpha")(
      Object.keys(PgExplorer.files).find((p) => p.endsWith(".rs"))
    );
    const position = { cursor: { from: 1, to: 2 }, topLineNumber: 3 };

    PgExplorer.saveEditorPosition(path, position);

    expect(PgExplorer.files[path].meta?.position).toEqual(position);
  });
});

describe("deleting a workspace that is not open", () => {
  beforeEach(reset);

  it("deletes it and leaves the open one current", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    await PgExplorer.createWorkspace("beta", { files: files("beta") });
    expect(PgExplorer.currentWorkspaceName).toBe("beta");

    await PgExplorer.deleteWorkspace("alpha");

    expect(PgExplorer.allWorkspaceNames).toEqual(["beta"]);
    expect(PgExplorer.currentWorkspaceName).toBe("beta");
  });

  it("drops one whose folder is already gone from storage", async () => {
    // A workspace listed in the config with no files under its folder: made
    // by another build, or a delete that removed the files and failed after
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    await PgExplorer.createWorkspace("beta", { files: files("beta") });
    await PgExplorer.fs.removeDir("/alpha/", { recursive: true });

    await PgExplorer.deleteWorkspace("alpha");

    expect(PgExplorer.allWorkspaceNames).toEqual(["beta"]);
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

/** The id of a workspace the explorer lists */
const idOf = (name: string) =>
  requireFor(`the id of workspace ${name}`)(PgExplorer.workspaceIdOf(name));

const stored = () =>
  (PgExplorer.fs as unknown as { __files: Map<string, string> }).__files;

const readConfig = () =>
  JSON.parse(
    requireFor("the stored workspaces config")(
      stored().get(PgWorkspace.WORKSPACES_CONFIG_PATH)
    )
  ) as {
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
    const alpha = idOf("alpha");
    const beta = idOf("beta");
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
    const alpha = idOf("alpha");
    const beta = idOf("beta");
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

  it("tells a listener the list changed when it takes a neighbour's", async () => {
    const alpha = idOf("alpha");
    const beta = idOf("beta");
    writeConfig({
      workspaces: [
        { id: alpha, name: "renamed" },
        { id: beta, name: "beta" },
      ],
      currentId: beta,
    });
    const changed = vi.fn();
    const { dispose } = PgExplorer.onDidChangeWorkspaceList(changed);

    try {
      await PgExplorer.refreshWorkspaces();
    } finally {
      dispose();
    }

    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the neighbour's list is this tab's", async () => {
    const changed = vi.fn();
    const { dispose } = PgExplorer.onDidChangeWorkspaceList(changed);

    try {
      await PgExplorer.refreshWorkspaces();
    } finally {
      dispose();
    }

    expect(changed).not.toHaveBeenCalled();
  });

  it("drops a workspace deleted elsewhere", async () => {
    const alpha = idOf("alpha");
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
    const alpha = idOf("alpha");
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

  it("tells a listener the list changed, announced or not", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    await PgExplorer.createWorkspace("beta", { files: files("beta") });
    const changed = vi.fn();
    const { dispose } = PgExplorer.onDidChangeWorkspaceList(changed);

    try {
      await PgExplorer.renameWorkspace("gamma", { from: "alpha" });
      await PgExplorer.renameWorkspace("delta", {
        from: "gamma",
        announce: true,
      });
    } finally {
      dispose();
    }

    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("renames it on disk and in the list, and stays where it was", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    const alphaId = PgExplorer.currentWorkspaceId;
    await PgExplorer.createWorkspace("beta", { files: files("beta") });

    await PgExplorer.renameWorkspace("gamma", { from: "alpha" });

    expect(PgExplorer.currentWorkspaceName).toBe("beta");
    expect(
      Array.from(
        requireFor("the workspace names")(PgExplorer.allWorkspaceNames)
      ).sort()
    ).toEqual(["beta", "gamma"]);
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

    expect(PgExplorer.workspaceNameOf(requireFor("alpha's id")(alphaId))).toBe(
      "alpha"
    );
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

// A repository or gist link opens as a temporary view, which drops the
// workspace list from memory; importing from there must still reach it
describe("creating a workspace from a temporary view", () => {
  beforeEach(reset);

  it("adds it beside the stored ones and leaves the temporary view", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    await PgExplorer.init({ files: [["/src/lib.rs", "temporary"]] });
    expect(PgExplorer.isTemporary).toBe(true);

    await PgExplorer.createWorkspace("beta", { files: files("beta") });

    expect(PgExplorer.isTemporary).toBe(false);
    expect(PgExplorer.allWorkspaceNames).toEqual(["alpha", "beta"]);
    expect(PgExplorer.currentWorkspaceName).toBe("beta");
  });

  // Importing a link whose project is already saved switches to it; a view
  // left temporary would skip every write and lose the user's edits
  it("leaves the temporary view when it switches to a stored workspace", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    await PgExplorer.init({ files: [["/src/lib.rs", "temporary"]] });
    await PgExplorer.readAllWorkspaceNames();

    await PgExplorer.switchWorkspace("alpha");

    expect(PgExplorer.isTemporary).toBe(false);
    expect(PgExplorer.currentWorkspaceName).toBe("alpha");
    await PgExplorer.createItem("/alpha/src/added.rs", "kept");
    expect(stored().get("/alpha/src/added.rs")).toBe("kept");
  });

  it("lists the stored workspaces while the view is temporary", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    await PgExplorer.init({ files: [["/src/lib.rs", "temporary"]] });

    expect(await PgExplorer.readAllWorkspaceNames()).toEqual(["alpha"]);
    expect(PgExplorer.isTemporary).toBe(true);
  });
});

// The project list read `allWorkspaceNames`, which a temporary view leaves
// undefined, so it went blank while a repository link was open (HOO-2794).
// The list reads the stored workspaces instead, and none becomes current
describe("the stored workspaces beside a temporary view", () => {
  beforeEach(reset);

  const LINK_FILES: Array<[string, string]> = [["/src/lib.rs", "from a link"]];
  const openLink = async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    await PgExplorer.createWorkspace("beta", { files: files("beta") });
    await PgExplorer.init({ files: LINK_FILES });
  };
  const storedIdOf = (name: string) =>
    readConfig().workspaces.find((w) => w.name === name)?.id;
  /** What another tab's create leaves in the store */
  const anotherTabCreatesDelta = () =>
    writeConfig({
      workspaces: readConfig().workspaces.concat({
        id: "w-delta",
        name: "delta",
      }),
      currentId: readConfig().currentId,
    });
  const expectLinkStillOpen = () => {
    expect(PgExplorer.isTemporary).toBe(true);
    expect(PgExplorer.currentWorkspaceName).toBeUndefined();
    expect(PgExplorer.allWorkspaceNames).toBeUndefined();
    expect(PgExplorer.getFileContent("/src/lib.rs")).toBe("from a link");
  };

  it("lists them, with their ids, while the link's project stays open", async () => {
    await openLink();

    expect(PgExplorer.storedWorkspaceNames).toEqual(["alpha", "beta"]);
    expect(PgExplorer.storedWorkspaceIdOf("alpha")).toBe(storedIdOf("alpha"));
    expectLinkStillOpen();
  });

  it("opens one picked from the list", async () => {
    await openLink();

    await PgExplorer.switchWorkspace("alpha");

    expect(PgExplorer.isTemporary).toBe(false);
    expect(PgExplorer.currentWorkspaceName).toBe("alpha");
    expect(PgExplorer.allWorkspaceNames).toEqual(["alpha", "beta"]);
    expect(PgExplorer.getFileContent("/alpha/src/lib.rs")).toBe(
      "declare_id!();"
    );
  });

  it("renames one in place, leaving the link's project open", async () => {
    await openLink();
    const id = storedIdOf("alpha");

    await PgExplorer.renameWorkspace("gamma", { from: "alpha" });

    expect(PgExplorer.storedWorkspaceNames).toEqual(["gamma", "beta"]);
    expect(storedIdOf("gamma")).toBe(id);
    expect(stored().get("/gamma/src/lib.rs")).toBe("declare_id!();");
    expect(stored().has("/alpha/src/lib.rs")).toBe(false);
    expectLinkStillOpen();
  });

  it("announces a rename with the stored id", async () => {
    await openLink();
    const id = storedIdOf("alpha");
    const announced: unknown[] = [];
    const listening = PgExplorer.onDidRenameWorkspace((renamed) =>
      announced.push(renamed)
    );
    try {
      await PgExplorer.renameWorkspace("gamma", {
        from: "alpha",
        announce: true,
      });
    } finally {
      listening.dispose();
    }

    expect(announced).toEqual([{ id }]);
  });

  it("deletes one, leaving the link's project open", async () => {
    await openLink();

    await PgExplorer.deleteWorkspace("alpha");

    expect(PgExplorer.storedWorkspaceNames).toEqual(["beta"]);
    expect(readConfig().workspaces.map((w) => w.name)).toEqual(["beta"]);
    expect(stored().has("/alpha/src/lib.rs")).toBe(false);
    expectLinkStillOpen();
  });

  // Another tab's change lands after the view read the list; a save of the
  // list the view read would drop it, folder left behind with no name
  it("keeps another tab's new workspace through a rename made beside the link", async () => {
    await openLink();
    anotherTabCreatesDelta();

    await PgExplorer.renameWorkspace("gamma", { from: "alpha" });

    expect(readConfig().workspaces.map((w) => w.name)).toEqual([
      "gamma",
      "beta",
      "delta",
    ]);
    expect(PgExplorer.storedWorkspaceNames).toEqual(["gamma", "beta", "delta"]);
  });

  it("writes nothing when the second read of a rename beside the link fails", async () => {
    await openLink();
    const real = PgExplorer.fs.readToJSON.bind(PgExplorer.fs);
    let reads = 0;
    const failing = vi
      .spyOn(PgExplorer.fs, "readToJSON")
      .mockImplementation(async (path: string) => {
        if (path === PgWorkspace.WORKSPACES_CONFIG_PATH) reads += 1;
        // Another tab's create lands while the folder moves, and the read
        // after it fails
        if (reads === 2) {
          anotherTabCreatesDelta();
          throw new Error("store went away");
        }
        return real(path);
      });
    try {
      await expect(
        PgExplorer.renameWorkspace("gamma", { from: "alpha" })
      ).rejects.toThrow("store went away");
    } finally {
      failing.mockRestore();
    }

    // The folder is back, and the store keeps another tab's workspace
    expect(stored().get("/alpha/src/lib.rs")).toBe("declare_id!();");
    expect(readConfig().workspaces.map((w) => w.name)).toEqual([
      "alpha",
      "beta",
      "delta",
    ]);
  });

  it("puts the folder back when a project is opened while a rename beside the link runs", async () => {
    await openLink();
    clearFailures();
    const realRename = PgExplorer.fs.rename.bind(PgExplorer.fs);
    const opening = vi
      .spyOn(PgExplorer.fs, "rename")
      .mockImplementationOnce(async (from: string, to: string) => {
        await realRename(from, to);
        // The user opens beta from the list while the folder moves
        await PgExplorer.switchWorkspace("beta");
      });
    try {
      await expect(
        PgExplorer.renameWorkspace("gamma", { from: "alpha" })
      ).rejects.toThrow(PgWorkspace.errors.LIST_CHANGED);
    } finally {
      opening.mockRestore();
    }

    expect(stored().get("/alpha/src/lib.rs")).toBe("declare_id!();");
    expect(readConfig().workspaces.map((w) => w.name)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(PgExplorer.currentWorkspaceName).toBe("beta");
    // Nothing failed to save: the list beta opened with never took the rename
    expect(getFailures()).toEqual([]);
  });

  it("drops the name when a project is opened while a delete beside the link runs", async () => {
    await openLink();
    const realRemove = PgExplorer.fs.removeDir.bind(PgExplorer.fs);
    const opening = vi
      .spyOn(PgExplorer.fs, "removeDir")
      .mockImplementationOnce(async (path, opts) => {
        await realRemove(path, opts);
        // The user opens beta from the list while the folder goes
        await PgExplorer.switchWorkspace("beta");
      });
    try {
      await PgExplorer.deleteWorkspace("alpha");
    } finally {
      opening.mockRestore();
    }

    expect(stored().has("/alpha/src/lib.rs")).toBe(false);
    expect(readConfig().workspaces.map((w) => w.name)).toEqual(["beta"]);
    expect(PgExplorer.allWorkspaceNames).toEqual(["beta"]);
    expect(PgExplorer.currentWorkspaceName).toBe("beta");
  });

  it("keeps another tab's new workspace through a delete made beside the link", async () => {
    await openLink();
    anotherTabCreatesDelta();

    await PgExplorer.deleteWorkspace("alpha");

    expect(readConfig().workspaces.map((w) => w.name)).toEqual([
      "beta",
      "delta",
    ]);
  });

  it("keeps a current workspace when the one open before the link is deleted", async () => {
    await openLink();
    expect(readConfig().currentId).toBe(storedIdOf("beta"));

    await PgExplorer.deleteWorkspace("beta");

    expect(readConfig().currentId).toBe(storedIdOf("alpha"));
    expectLinkStillOpen();
  });

  it("opens the link's files and lists nothing when the stored list cannot be read", async () => {
    await openLink();
    clearFailures();
    stored().set(PgWorkspace.WORKSPACES_CONFIG_PATH, "{ not json");

    await PgExplorer.init({ files: LINK_FILES });

    expect(PgExplorer.getFileContent("/src/lib.rs")).toBe("from a link");
    expect(PgExplorer.storedWorkspaceNames).toBeUndefined();
    expect(getFailures()).toEqual([
      expect.objectContaining({ what: "read the stored workspaces" }),
    ]);
  });

  it("reads the names for an import without making one current", async () => {
    await openLink();

    expect(await PgExplorer.readAllWorkspaceNames()).toEqual(["alpha", "beta"]);
    expectLinkStillOpen();
  });

  // Another tab's rename or delete reached the view's tab, but the list it
  // showed kept the old names, and opening one of them failed
  describe("when another tab changes the list", () => {
    afterEach(() => vi.restoreAllMocks());

    /** What another tab's rename of alpha and delete of beta leave behind */
    const anotherTabRenamesAndDeletes = () =>
      writeConfig({
        workspaces: [
          {
            id: requireFor("alpha's stored id")(storedIdOf("alpha")),
            name: "gamma",
          },
        ],
        currentId: readConfig().currentId,
      });

    it("shows the store's names after a refresh, with the link left open", async () => {
      await openLink();
      const id = storedIdOf("alpha");
      anotherTabRenamesAndDeletes();
      const announced = vi.fn();
      const listening = PgExplorer.onDidChangeWorkspaceList(announced);
      try {
        expect(await PgExplorer.refreshWorkspaces()).toBe(true);
      } finally {
        listening.dispose();
      }

      expect(PgExplorer.storedWorkspaceNames).toEqual(["gamma"]);
      expect(PgExplorer.storedWorkspaceIdOf("gamma")).toBe(id);
      expect(announced).toHaveBeenCalledTimes(1);
      expectLinkStillOpen();
    });

    it("keeps the names shown when the store fails to read", async () => {
      await openLink();
      clearFailures();
      stored().set(PgWorkspace.WORKSPACES_CONFIG_PATH, "{ not json");

      expect(await PgExplorer.refreshWorkspaces()).toBe(false);

      expect(PgExplorer.storedWorkspaceNames).toEqual(["alpha", "beta"]);
      expect(getFailures()).toEqual([
        expect.objectContaining({ what: "refresh workspaces" }),
      ]);
      expectLinkStillOpen();
    });

    it("leaves a list set during the read alone", async () => {
      // A rename beside the link saves its list while the refresh reads an
      // older store; taken after it, that read would bring the old name back
      await openLink();
      const read = PgExplorer.fs.readToJSON.bind(PgExplorer.fs);
      vi.spyOn(PgExplorer.fs, "readToJSON").mockImplementationOnce(
        async (path: string) => {
          const before = await read(path);
          await PgExplorer.renameWorkspace("gamma", { from: "alpha" });
          return before;
        }
      );

      expect(await PgExplorer.refreshWorkspaces()).toBe(true);

      expect(PgExplorer.storedWorkspaceNames).toEqual(["gamma", "beta"]);
      expectLinkStillOpen();
    });
  });
});

// The tree finds an item by its path on every render while a file waits to
// be shown (`useHandleItemState`), so a path the selector cannot hold must
// not throw: a file name may carry a quote
describe("PgExplorer.getElFromPath", () => {
  afterEach(() => document.body.replaceChildren());

  for (const path of [
    "/w1/src/it's.rs",
    '/w1/src/say "hi".rs',
    "/w1/src/back\\slash.rs",
  ]) {
    it(`finds the item at ${path}`, () => {
      const el = document.createElement("div");
      el.setAttribute("data-path", path);
      document.body.append(el);
      expect(PgExplorer.getElFromPath(path)).toBe(el);
    });
  }
});

describe("writes past a project limit", () => {
  const storedFiles = () =>
    (PgExplorer.fs as unknown as { __files: Map<string, string> }).__files;
  let sent: ReturnType<typeof memoryProvider>;

  /** `count` small files under `/name/src/`, `f0.rs` onward */
  const many = (name: string, count: number): Array<[string, string]> =>
    Array.from({ length: count }, (_, i) => [`/${name}/src/f${i}.rs`, "x"]);

  const refusals = () =>
    sent.events.filter(({ name }) => name === "explorer_limit_refused");

  beforeEach(async () => {
    await reset();
    sent = memoryProvider();
    initTelemetry({ providers: [sent] });
  });
  afterEach(() => resetTelemetry());

  describe("creating a file", () => {
    it("refuses the 51st file and writes nothing", async () => {
      await PgExplorer.createWorkspace("alpha", { files: many("alpha", 50) });

      await expect(PgExplorer.createItem("src/extra.rs")).rejects.toThrow(
        "A project can have at most 50 files."
      );
      expect(storedFiles().has("/alpha/src/extra.rs")).toBe(false);
      expect(PgExplorer.files["/alpha/src/extra.rs"]).toBeUndefined();
      expect(refusals()).toEqual([
        {
          name: "explorer_limit_refused",
          params: { action: "create", limit: "count" },
        },
      ]);
    });

    it("creates a folder, which is not a file", async () => {
      await PgExplorer.createWorkspace("alpha", { files: many("alpha", 50) });

      await PgExplorer.createItem("src/more/");
      expect(PgExplorer.files["/alpha/src/more/"]).toEqual({});
      expect(refusals()).toEqual([]);
    });

    it("keeps a file's content when an overwrite is over the size limit", async () => {
      // What the assistant's file write does: `createItem` with `override`
      await PgExplorer.createWorkspace("alpha", {
        files: [["/alpha/src/lib.rs", "before"]],
      });

      await expect(
        PgExplorer.createItem("src/lib.rs", "a".repeat(200_000), {
          override: true,
        })
      ).rejects.toThrow("A file can be at most 128 KB.");
      expect(storedFiles().get("/alpha/src/lib.rs")).toBe("before");
      expect(PgExplorer.files["/alpha/src/lib.rs"].content).toBe("before");
      expect(refusals()[0].params).toEqual({
        action: "create",
        limit: "size",
      });
    });

    it("refuses another file in a project restored over the limit", async () => {
      await PgExplorer.createWorkspace("alpha", { files: many("alpha", 1) });
      // A restore is not refused, so a project stored before the limits
      // arrives whole
      await PgExplorer.replaceWorkspaceFiles(
        "alpha",
        Object.fromEntries(
          Array.from({ length: 60 }, (_, i) => [`src/f${i}.rs`, "x"])
        )
      );
      await PgExplorer.switchWorkspace("alpha");

      await expect(PgExplorer.createItem("src/extra.rs")).rejects.toThrow(
        "A project can have at most 50 files."
      );
      expect(storedFiles().has("/alpha/src/extra.rs")).toBe(false);
    });

    it("refuses an edit to an existing file in a project restored over the limit", async () => {
      await PgExplorer.createWorkspace("alpha", { files: many("alpha", 1) });
      await PgExplorer.replaceWorkspaceFiles(
        "alpha",
        Object.fromEntries(
          Array.from({ length: 60 }, (_, i) => [`src/f${i}.rs`, "x"])
        )
      );
      await PgExplorer.switchWorkspace("alpha");

      // What the assistant's file write does: `createItem` with `override`
      await expect(
        PgExplorer.createItem("src/f1.rs", "y", { override: true })
      ).rejects.toThrow("A project can have at most 50 files.");
      expect(storedFiles().get("/alpha/src/f1.rs")).toBe("x");
    });

    it("creates a small file beside another file over the size limit", async () => {
      await PgExplorer.createWorkspace("alpha", {
        files: [["/alpha/src/lib.rs", ""]],
      });
      // Pasted in the editor, which is not refused
      await PgExplorer.replaceWorkspaceFiles("alpha", {
        "src/lib.rs": "a".repeat(150_000),
      });
      await PgExplorer.switchWorkspace("alpha");

      await PgExplorer.createItem("notes.md");
      expect(storedFiles().has("/alpha/notes.md")).toBe(true);
    });

    it("refuses an overwrite that leaves a project over the size limit", async () => {
      await PgExplorer.createWorkspace("alpha", {
        files: [["/alpha/src/lib.rs", ""]],
      });
      await PgExplorer.replaceWorkspaceFiles(
        "alpha",
        Object.fromEntries(
          Array.from({ length: 5 }, (_, i) => [
            `src/f${i}.rs`,
            "a".repeat(110_000),
          ])
        )
      );
      await PgExplorer.switchWorkspace("alpha");

      await expect(
        PgExplorer.createItem("src/f0.rs", "a".repeat(110_001), {
          override: true,
        })
      ).rejects.toThrow("A project can be at most 512 KB.");
      // 540,000 bytes: smaller, still over
      await expect(
        PgExplorer.createItem("src/f0.rs", "a".repeat(100_000), {
          override: true,
        })
      ).rejects.toThrow("A project can be at most 512 KB.");
      // 441,000 bytes: back under
      await PgExplorer.createItem("src/f0.rs", "a".repeat(1_000), {
        override: true,
      });
      expect(storedFiles().get("/alpha/src/f0.rs")).toHaveLength(1_000);
    });

    it("counts the generated files sync carries toward the project size", async () => {
      // 524,000 bytes of user files: 288 bytes under the limit
      await PgExplorer.createWorkspace("alpha", {
        files: Array.from({ length: 4 }, (_, i) => [
          `/alpha/src/f${i}.rs`,
          "a".repeat(131_000),
        ]),
      });
      // Written straight to the store, as `PgProgramInfo` does, so the
      // explorer's file map never holds it
      await PgExplorer.fs.writeFile(
        "/alpha/.workspace/program-info.json",
        "a".repeat(200),
        { createParents: true }
      );

      await expect(
        PgExplorer.createItem("notes.md", "a".repeat(100))
      ).rejects.toThrow("A project can be at most 512 KB.");
      expect(storedFiles().has("/alpha/notes.md")).toBe(false);
    });

    it("counts a dot-named user file only the store holds toward the project size", async () => {
      // 524,000 bytes of user files: 288 bytes under the limit
      await PgExplorer.createWorkspace("alpha", {
        files: Array.from({ length: 4 }, (_, i) => [
          `/alpha/src/f${i}.rs`,
          "a".repeat(131_000),
        ]),
      });
      // As an import or another device writes it: `isItemNameValid` keeps
      // it out of the explorer's file map, yet sync uploads it
      await PgExplorer.fs.writeFile("/alpha/.github/ci.yml", "a".repeat(200), {
        createParents: true,
      });

      const refused = PgExplorer.createItem("notes.md", "a".repeat(100));
      await expect(refused).rejects.toThrow("A project can be at most 512 KB.");
      await expect(refused).rejects.toMatchObject({
        limit: { reason: "project-too-large", limit: 524_288 },
      });
      expect(storedFiles().has("/alpha/notes.md")).toBe(false);
    });

    it("leaves the workspace's local state out of the project size", async () => {
      await PgExplorer.createWorkspace("alpha", {
        files: Array.from({ length: 4 }, (_, i) => [
          `/alpha/src/f${i}.rs`,
          "a".repeat(131_000),
        ]),
      });
      // Which tabs are open: local, never synced
      await PgExplorer.fs.writeFile(
        "/alpha/.workspace/metadata.json",
        "a".repeat(200),
        { createParents: true }
      );

      await PgExplorer.createItem("notes.md", "a".repeat(100));
      expect(storedFiles().has("/alpha/notes.md")).toBe(true);
    });
  });

  describe("renaming", () => {
    it("refuses a folder rename that pushes a file path over 256 characters", async () => {
      // `dir/` + 242 + `.rs` is 249 code points, under the 256 limit; under a
      // 13-character folder name it is 259
      const file = `${"n".repeat(242)}.rs`;
      await PgExplorer.createWorkspace("alpha", {
        files: [
          ["/alpha/src/lib.rs", ""],
          [`/alpha/dir/${file}`, "x"],
        ],
      });

      await expect(
        PgExplorer.renameItem("/alpha/dir/", `/alpha/${"d".repeat(13)}`)
      ).rejects.toThrow("A file path can be at most 256 characters.");
      expect(storedFiles().get(`/alpha/dir/${file}`)).toBe("x");
      expect(PgExplorer.files[`/alpha/dir/${file}`]).toBeDefined();
      expect(refusals()[0].params).toEqual({
        action: "rename",
        limit: "path",
      });
    });

    it("refuses a file rename that pushes its path over 256 characters", async () => {
      // `src/` + 249 + `.rs` is 256 code points, at the limit; one more is 257
      const file = `${"n".repeat(249)}.rs`;
      await PgExplorer.createWorkspace("alpha", {
        files: [
          ["/alpha/src/lib.rs", ""],
          [`/alpha/src/${file}`, "x"],
        ],
      });

      await expect(
        PgExplorer.renameItem(`/alpha/src/${file}`, `/alpha/src/${file}n`)
      ).rejects.toThrow("A file path can be at most 256 characters.");
      expect(storedFiles().get(`/alpha/src/${file}`)).toBe("x");
      expect(refusals()[0].params).toEqual({
        action: "rename",
        limit: "path",
      });
    });

    it("renames the open workspace whatever its name's length", async () => {
      // A workspace's name is not part of any path sync carries: a file 250
      // code points from the root stays 250 under a 20-character name
      const file = `${"n".repeat(243)}.rs`;
      await PgExplorer.createWorkspace("alpha", {
        files: [
          ["/alpha/src/lib.rs", ""],
          [`/alpha/src/${file}`, "x"],
        ],
      });
      const renamed = "r".repeat(20);

      await PgExplorer.renameWorkspace(renamed);
      expect(storedFiles().get(`/${renamed}/src/${file}`)).toBe("x");
      expect(refusals()).toEqual([]);
    });

    it("renames in a project over another limit", async () => {
      await PgExplorer.createWorkspace("alpha", { files: many("alpha", 1) });
      await PgExplorer.replaceWorkspaceFiles(
        "alpha",
        Object.fromEntries(
          Array.from({ length: 60 }, (_, i) => [`src/f${i}.rs`, "x"])
        )
      );
      await PgExplorer.switchWorkspace("alpha");

      await PgExplorer.renameItem("/alpha/src/f1.rs", "/alpha/src/g1.rs");
      expect(storedFiles().has("/alpha/src/g1.rs")).toBe(true);
    });
  });

  describe("importing", () => {
    it("creates no workspace from a folder of 64 files", async () => {
      await expect(
        PgExplorer.createWorkspace("big", { files: many("big", 64) })
      ).rejects.toThrow(
        "This project has 64 files. A project can have at most 50."
      );
      expect(PgExplorer.allWorkspaceNames).not.toContain("big");
      expect([...storedFiles().keys()].some((k) => k.startsWith("/big/"))).toBe(
        false
      );
      expect(refusals()[0].params).toEqual({
        action: "import",
        limit: "count",
      });
    });

    it("names a large file the way the import dialog shows it", async () => {
      await expect(
        PgExplorer.createWorkspace("github-x", {
          files: [
            ["src/lib.rs", "x"],
            ["src/data.rs", "a".repeat(143_360)],
          ],
        })
      ).rejects.toThrow("src/data.rs is 140 KB. A file can be at most 128 KB.");
    });

    it("measures the project size of an import", async () => {
      const imported = Array.from(
        { length: 6 },
        (_, i) => [`src/f${i}.rs`, "a".repeat(100_000)] as [string, string]
      );
      await expect(
        PgExplorer.createWorkspace("big", { files: imported })
      ).rejects.toThrow(
        "This project is 586 KB. A project can be at most 512 KB."
      );
      expect(refusals()[0].params).toEqual({
        action: "import",
        limit: "project",
      });
    });

    it("refuses a temporary project over a limit and keeps it temporary", async () => {
      const temporary = Array.from(
        { length: 51 },
        (_, i) => [`/src/f${i}.rs`, "x"] as [string, string]
      );
      await PgExplorer.init({ files: temporary });

      await expect(
        PgExplorer.createWorkspace("kept", { fromTemporary: true })
      ).rejects.toThrow("This project has 51 files.");
      expect(PgExplorer.isTemporary).toBe(true);
    });
  });

  describe("every bundled template and tutorial", () => {
    // `client-v2/`
    const root = nodePath.join(__dirname, "../../..");

    /** Every file under `dir`, relative to it, `.raw` dropped */
    const read = (dir: string, prefix = ""): Array<[string, string]> =>
      readdirSync(dir).flatMap((name) => {
        const full = nodePath.join(dir, name);
        const rel = prefix + name;
        if (statSync(full).isDirectory()) return read(full, `${rel}/`);
        return [[rel.replace(/\.raw$/, ""), readFileSync(full, "utf8")]];
      });

    /** Directories holding a template's or a tutorial's starting files */
    const sources = () => {
      const found: Array<[string, string]> = [];
      for (const base of ["src/frameworks", "src/tutorials"]) {
        for (const name of readdirSync(nodePath.join(root, base))) {
          const filesDir = nodePath.join(root, base, name, "files");
          if (existsSync(filesDir)) found.push([`${base}/${name}`, filesDir]);
        }
      }
      // Markdown tutorials ship from `public/`, which `yarn generate-fast`
      // copies out of `client/public`
      const pub = nodePath.join(root, "public/tutorials");
      for (const name of readdirSync(pub)) {
        const filesDir = nodePath.join(pub, name, "files");
        if (existsSync(filesDir))
          found.push([`public/tutorials/${name}`, filesDir]);
      }
      return found;
    };

    it("creates a workspace from each without a refusal", async () => {
      const all = sources();
      expect(all.length).toBeGreaterThan(10);
      for (const [i, [source, dir]] of all.entries()) {
        const workspaceFiles = read(dir)
          .filter(([p]) => p !== "index.ts")
          .map(([p, content]): [string, string] => [`/w${i}/${p}`, content]);
        await expect(
          PgExplorer.createWorkspace(`w${i}`, { files: workspaceFiles }),
          source
        ).resolves.toBeUndefined();
      }
      expect(refusals()).toEqual([]);
    });
  });

  describe("writes that are not refused", () => {
    it("saves the editor's content over the size limit", async () => {
      await PgExplorer.createWorkspace("alpha", {
        files: [["/alpha/src/lib.rs", "x"]],
      });
      const big = "a".repeat(150_000);

      PgExplorer.saveFileToState("src/lib.rs", big);
      expect(PgExplorer.files["/alpha/src/lib.rs"].content).toBe(big);
    });

    it("writes a restored file over the size limit", async () => {
      await PgExplorer.createWorkspace("alpha", {
        files: [["/alpha/src/lib.rs", "x"]],
      });
      const big = "a".repeat(150_000);

      await PgExplorer.replaceWorkspaceFiles("alpha", { "src/lib.rs": big });
      expect(storedFiles().get("/alpha/src/lib.rs")).toBe(big);
      expect(refusals()).toEqual([]);
    });
  });
});

/**
 * lightning-fs saves its folder tree 500 ms after the last write, so a page
 * load inside that window loses whatever changed the tree: a file or folder
 * created, renamed or deleted, and a workspace file written for the first
 * time (a new project, or after sync replaced the files). Each of those is
 * followed by a flush; a write that only changes a file's content is not,
 * since the tree already holds the file.
 *
 * `writeWorkspaceFile` remembers which paths it flushed for the whole module;
 * `createWorkspace` in `beforeEach` empties that through its create event.
 */
describe("writes that change the folder tree", () => {
  beforeEach(async () => {
    await reset();
    await PgExplorer.createWorkspace("alpha", {
      files: files("alpha"),
      defaultOpenFile: "/alpha/src/lib.rs",
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The filesystem calls made from here on, in order, as `<method> <path>` */
  const recordFs = () => {
    const calls: string[] = [];
    const fs = PgExplorer.fs as unknown as Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >;
    for (const method of [
      "writeFile",
      "createDir",
      "rename",
      "removeFile",
      "removeDir",
      "flush",
    ]) {
      const original = fs[method].bind(fs);
      vi.spyOn(fs, method).mockImplementation(async (...args: unknown[]) => {
        calls.push(args.length ? `${method} ${args[0]}` : method);
        return original(...args);
      });
    }
    return calls;
  };

  /** The call right after the last one that starts with `call` */
  const after = (calls: string[], call: string) => {
    const index = calls.findLastIndex((c) => c.startsWith(call));
    expect(index).not.toBe(-1);
    return calls[index + 1];
  };

  it("flushes after creating a file", async () => {
    const calls = recordFs();

    await PgExplorer.createItem("/alpha/src/new.rs", "fn main() {}");

    expect(after(calls, "writeFile /alpha/src/new.rs")).toBe("flush");
  });

  it("flushes after creating a folder", async () => {
    const calls = recordFs();

    await PgExplorer.createItem("/alpha/src/nested/");

    expect(after(calls, "createDir /alpha/src/nested/")).toBe("flush");
  });

  it("does not flush when it only replaces a file's content", async () => {
    const calls = recordFs();

    await PgExplorer.createItem("/alpha/src/lib.rs", "changed", {
      override: true,
    });

    expect(after(calls, "writeFile /alpha/src/lib.rs")).not.toBe("flush");
  });

  it("flushes after renaming a file", async () => {
    const calls = recordFs();

    await PgExplorer.renameItem("/alpha/src/lib.rs", "/alpha/src/renamed.rs");

    expect(after(calls, "rename /alpha/src/lib.rs")).toBe("flush");
  });

  it("flushes after deleting a file", async () => {
    await PgExplorer.createItem("/alpha/src/gone.rs", "");
    const calls = recordFs();

    await PgExplorer.deleteItem("/alpha/src/gone.rs");

    expect(after(calls, "removeFile /alpha/src/gone.rs")).toBe("flush");
  });

  it("flushes after the metadata a new workspace writes", async () => {
    const calls = recordFs();

    await PgExplorer.createWorkspace("beta", {
      files: files("beta"),
      defaultOpenFile: "/beta/src/lib.rs",
    });

    expect(after(calls, "writeFile /beta/.workspace/metadata.json")).toBe(
      "flush"
    );
  });

  it("flushes the metadata again once sync replaced the files without it", async () => {
    await PgExplorer.saveMeta();
    // A snapshot from another device that has none of the files the metadata
    // lists, so nothing is kept and the next save makes the file anew
    await PgExplorer.replaceWorkspaceFiles("alpha", {
      "src/other.rs": "from elsewhere",
    });
    const calls = recordFs();

    await PgExplorer.saveMeta();

    expect(after(calls, "writeFile /alpha/.workspace/metadata.json")).toBe(
      "flush"
    );
  });

  it("does not flush the metadata again once it has", async () => {
    await PgExplorer.saveMeta();
    const calls = recordFs();

    await PgExplorer.saveMeta();

    expect(calls).toEqual(["writeFile /alpha/.workspace/metadata.json"]);
  });

  it("flushes after deleting a folder", async () => {
    // With a file in it: the in-memory store knows a folder by what is in it
    await PgExplorer.createItem("/alpha/src/nested/a.rs", "");
    const calls = recordFs();

    await PgExplorer.deleteItem("/alpha/src/nested/");

    expect(after(calls, "removeDir /alpha/src/nested/")).toBe("flush");
  });

  describe("when saving the tree fails", () => {
    beforeEach(() => {
      clearFailures();
      vi.spyOn(PgExplorer.fs, "flush").mockRejectedValue(new Error("quota"));
    });

    // The change is on disk by then: failing the operation would leave the
    // explorer showing what the store no longer holds
    it("still creates the file, and reports the failure", async () => {
      await PgExplorer.createItem("/alpha/src/new.rs", "");

      expect(PgExplorer.getFile("/alpha/src/new.rs")).toBeDefined();
      expect(getFailures().map((f) => f.what)).toContain(
        "save the folder tree after a create"
      );
    });

    it("still renames the file, and reports the failure", async () => {
      await PgExplorer.renameItem("/alpha/src/lib.rs", "/alpha/src/renamed.rs");

      expect(PgExplorer.getFile("/alpha/src/renamed.rs")).toBeDefined();
      expect(PgExplorer.getFile("/alpha/src/lib.rs")).toBeNull();
      expect(getFailures().map((f) => f.what)).toContain(
        "save the folder tree after a rename"
      );
    });

    it("still deletes the file, and reports the failure", async () => {
      await PgExplorer.createItem("/alpha/src/gone.rs", "");
      clearFailures();

      await PgExplorer.deleteItem("/alpha/src/gone.rs");

      expect(PgExplorer.getFile("/alpha/src/gone.rs")).toBeNull();
      expect(getFailures().map((f) => f.what)).toContain(
        "save the folder tree after a delete"
      );
    });
  });

  describe("a workspace whose folder is gone", () => {
    /** Rejects writes and new folders under `root`, as lightning-fs does once it is deleted */
    const goneUnder = (root: string) => {
      const fs = PgExplorer.fs as unknown as Record<
        string,
        (...args: unknown[]) => Promise<unknown>
      >;
      const createDir = vi.fn();
      for (const method of ["writeFile", "createDir"]) {
        const original = fs[method].bind(fs);
        vi.spyOn(fs, method).mockImplementation(async (...args: unknown[]) => {
          if (method === "createDir") createDir(args[0]);
          if (String(args[0]).startsWith(root)) {
            throw Object.assign(new Error(`ENOENT: ${args[0]}`), {
              code: "ENOENT",
            });
          }
          return original(...args);
        });
      }
      return { createDir };
    };

    it("gets no metadata, and its folder is not made again", async () => {
      const { createDir } = goneUnder("/alpha/");

      await expect(PgExplorer.saveMeta()).resolves.toBeUndefined();
      expect(createDir).not.toHaveBeenCalledWith("/alpha/");
    });

    it("can still be left for another one", async () => {
      await PgExplorer.createWorkspace("beta", { files: files("beta") });
      goneUnder("/beta/");

      await PgExplorer.switchWorkspace("alpha");

      expect(PgExplorer.currentWorkspaceName).toBe("alpha");
    });
  });
});

describe("renaming an item", () => {
  beforeEach(reset);

  // The editor's autosave flushes on this event, so a pending edit is written
  // at the old path and moved with the file; announced after the move, the
  // save found its path gone and dropped the edit
  it("announces the rename before anything moves", async () => {
    await PgExplorer.createWorkspace("alpha", { files: files("alpha") });
    const order: string[] = [];
    const rename = vi.spyOn(PgExplorer.fs, "rename");
    rename.mockImplementation(async () => {
      order.push("fs.rename");
    });
    const willRename = PgExplorer.onWillRenameItem((path) => {
      order.push(`will ${path}`);
      expect(PgExplorer.getFile(path)).not.toBeNull();
    });

    await PgExplorer.renameItem("src/lib.rs", "src/main.rs");
    willRename.dispose();
    rename.mockRestore();

    expect(order).toEqual([
      `will ${PgExplorer.convertToFullPath("src/lib.rs")}`,
      "fs.rename",
    ]);
  });

  it("carries a write made on the announcement to the new name", async () => {
    await PgExplorer.createWorkspace("alpha", {
      files: [
        ["/alpha/src/lib.rs", "declare_id!();"],
        ["/alpha/client/client.ts", "before"],
      ],
    });
    const before = PgExplorer.convertToFullPath("client/client.ts");
    // What the autosave does: state at once, the disk write started and not
    // awaited, so only the fs's call order puts it ahead of the rename
    const willRename = PgExplorer.onWillRenameItem(() => {
      PgExplorer.saveFileToState(before, "edited");
      void PgExplorer.fs.writeFile(before, "edited");
    });

    await PgExplorer.renameItem("client", "web");
    willRename.dispose();

    const moved = PgExplorer.convertToFullPath("web/client.ts");
    expect(PgExplorer.getFile(moved)?.content).toBe("edited");
    expect(await PgExplorer.fs.readToString(moved)).toBe("edited");
  });

  it("announces nothing for a rename it refuses", async () => {
    await PgExplorer.createWorkspace("alpha", {
      files: [
        ["/alpha/src/lib.rs", "a"],
        ["/alpha/src/b.rs", "b"],
      ],
    });
    const announced = vi.fn();
    const willRename = PgExplorer.onWillRenameItem(announced);

    await expect(
      PgExplorer.renameItem("src/lib.rs", "src/b.rs")
    ).rejects.toThrow(PgExplorer.errors.ALREADY_EXISTS);
    willRename.dispose();

    expect(announced).not.toHaveBeenCalled();
  });
});

describe("deleting a file that has no tab", () => {
  beforeEach(reset);

  // A delete closes only the tabs of what it deletes; a path with no tab
  // has nothing to close
  it("leaves the open tabs and the selected tab as they were", async () => {
    await PgExplorer.createWorkspace("alpha", {
      files: [
        ["/alpha/src/lib.rs", "declare_id!();"],
        ["/alpha/client/client.ts", "client"],
        ["/alpha/tests/anchor.test.ts", "test"],
      ],
    });
    const lib = PgExplorer.convertToFullPath("src/lib.rs");
    const client = PgExplorer.convertToFullPath("client/client.ts");
    PgExplorer.setTabs([lib, client]);
    PgExplorer.openFile(lib);

    await PgExplorer.deleteItem("tests/anchor.test.ts");

    expect(PgExplorer.tabs).toEqual([lib, client]);
    expect(PgExplorer.currentFilePath).toBe(lib);
  });

  it("closes only the tabs of a folder's files when the folder goes", async () => {
    await PgExplorer.createWorkspace("alpha", {
      files: [
        ["/alpha/src/lib.rs", "declare_id!();"],
        ["/alpha/client/a.ts", "a"],
        ["/alpha/client/b.ts", "b"],
        ["/alpha/tests/anchor.test.ts", "test"],
      ],
    });
    const lib = PgExplorer.convertToFullPath("src/lib.rs");
    const a = PgExplorer.convertToFullPath("client/a.ts");
    const test = PgExplorer.convertToFullPath("tests/anchor.test.ts");
    PgExplorer.setTabs([lib, a, test]);
    PgExplorer.openFile(lib);

    await PgExplorer.deleteItem("client");

    expect(PgExplorer.tabs).toEqual([lib, test]);
    expect(PgExplorer.currentFilePath).toBe(lib);
  });
});
