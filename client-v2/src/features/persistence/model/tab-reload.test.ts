import type { Mock } from "vitest";
import { reloadCurrentFromDisk } from "./tab-reload";
import { PgEditorModels } from "./editor-models";
import { clearFailures, getFailures } from "./diagnostics";
import { PgCommon } from "../../../utils/common";
import { PgExplorer } from "../../../utils/explorer/explorer";
import { PgFs } from "../../../utils/explorer/fs";
import { PgRouter } from "../../../utils/router";
import { PgWorkspace } from "../../../utils/explorer/workspace";

vi.mock("./editor-models", () => ({
  PgEditorModels: {
    valueOf: vi.fn(async () => null),
    drop: vi.fn(async () => {}),
    dropUnder: vi.fn(async () => {}),
    anyEditedUnder: vi.fn(async () => false),
  },
}));

const store = () =>
  (PgFs as unknown as { __files: Map<string, string> }).__files;

/** What this tab holds in memory, keyed the way the explorer keys it */
let memory: Record<string, { content?: string }>;

beforeEach(() => {
  store().clear();
  clearFailures();
  memory = { "/alpha/src/lib.rs": { content: "old" } };
  store().set("/alpha/src/lib.rs", "old");
  vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue("alpha");
  vi.spyOn(PgExplorer, "isTemporary", "get").mockReturnValue(false);
  vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue("a1");
  vi.spyOn(PgExplorer, "files", "get").mockImplementation(
    () => memory as typeof PgExplorer.files
  );
  vi.spyOn(PgExplorer, "getCurrentFile").mockImplementation(
    () =>
      ({
        path: "/alpha/src/lib.rs",
        content: memory["/alpha/src/lib.rs"]?.content,
      } as ReturnType<typeof PgExplorer.getCurrentFile>)
  );
  vi.spyOn(PgExplorer, "switchWorkspace").mockResolvedValue(undefined);
  vi.spyOn(PgExplorer, "refreshWorkspaces").mockResolvedValue(true);
  vi.spyOn(PgCommon, "createAndDispatchCustomEvent");
  // The answers the factory gives: `mockReset` (see `vitest.config.ts`)
  // restores them before each test anyway, and they are restated here so
  // the test reads on its own. `valueOf` must answer `null`, not
  // `undefined`, or every path reads as "someone is typing in it".
  (PgEditorModels.valueOf as Mock).mockResolvedValue(null);
  (PgEditorModels.anyEditedUnder as Mock).mockResolvedValue(false);
  // The real one runs `then` once the models are gone; so does this
  (PgEditorModels.dropUnder as Mock).mockImplementation(
    async (_prefix: string, then?: () => void) => then?.()
  );
  // What an open does for the reload's own record of the tree: the name it
  // was opened under, what it read, and that it is no longer "left"
  PgCommon.createAndDispatchCustomEvent(
    PgExplorer.events.ON_DID_SWITCH_WORKSPACE
  );
  (PgCommon.createAndDispatchCustomEvent as Mock).mockClear();
});

afterEach(() => vi.restoreAllMocks());

const dispatched = () =>
  (PgCommon.createAndDispatchCustomEvent as Mock).mock.calls.map(
    ([name]) => name
  );

describe("reloadCurrentFromDisk", () => {
  it("does nothing when memory already matches disk", async () => {
    expect(await reloadCurrentFromDisk()).toBe("unchanged");
    expect(PgEditorModels.drop).not.toHaveBeenCalled();
    expect(PgExplorer.switchWorkspace).not.toHaveBeenCalled();
  });

  it("takes another tab's edit into state and the editor, quietly", async () => {
    store().set("/alpha/src/lib.rs", "from the other tab");

    expect(await reloadCurrentFromDisk()).toBe("contents");
    expect(memory["/alpha/src/lib.rs"].content).toBe("from the other tab");
    expect(PgEditorModels.drop).toHaveBeenCalledWith(["/alpha/src/lib.rs"]);
    // The open file is re-announced so the editor rebuilds its model...
    expect(dispatched()).toContain(PgExplorer.events.ON_DID_OPEN_FILE);
    // ...and nothing that schedules an upload fires
    expect(dispatched()).not.toContain(PgExplorer.events.ON_DID_SAVE_FILE);
    expect(PgExplorer.switchWorkspace).not.toHaveBeenCalled();
  });

  it("keeps a file the user is typing in", async () => {
    store().set("/alpha/src/lib.rs", "from the other tab");
    (PgEditorModels.valueOf as Mock).mockResolvedValueOnce("typing");

    expect(await reloadCurrentFromDisk()).toBe("unchanged");
    expect(memory["/alpha/src/lib.rs"].content).toBe("old");
    expect(PgEditorModels.drop).not.toHaveBeenCalled();
  });

  it("keeps an autosave that lands while the store is being read", async () => {
    // The autosave puts its text into state first and writes it second. A
    // reload reading the store in between found the older text on disk and
    // put it back over the newer text in state.
    store().set("/alpha/src/lib.rs", "old on disk");
    const read = PgFs.readToString.bind(PgFs);
    vi.spyOn(PgFs, "readToString").mockImplementationOnce(async (path) => {
      memory["/alpha/src/lib.rs"].content = "typed, write in flight";
      return await read(path);
    });

    expect(await reloadCurrentFromDisk()).toBe("unchanged");
    expect(memory["/alpha/src/lib.rs"].content).toBe("typed, write in flight");
    expect(PgEditorModels.drop).not.toHaveBeenCalled();
  });

  it("re-opens when the other tab changed which files exist", async () => {
    store().set("/alpha/src/new.rs", "created elsewhere");

    expect(await reloadCurrentFromDisk()).toBe("reopened");
    expect(PgEditorModels.dropUnder).toHaveBeenCalledWith(
      "/alpha/",
      expect.any(Function)
    );
    expect(PgExplorer.switchWorkspace).toHaveBeenCalledWith("alpha");
  });

  it("switches before dropping the models, then opens the file again", async () => {
    // Dropping first left the editor with no model for as long as the
    // switch's saves took, and a pending autosave then saved the empty
    // editor over the open file
    const order: string[] = [];
    (PgExplorer.switchWorkspace as Mock).mockImplementation(async () => {
      order.push("switch");
    });
    (PgEditorModels.dropUnder as Mock).mockImplementation(
      async (_prefix: string, then?: () => void) => {
        order.push("drop");
        then?.();
      }
    );
    (PgCommon.createAndDispatchCustomEvent as Mock).mockImplementation(
      (name: string) => {
        if (name === PgExplorer.events.ON_DID_OPEN_FILE) order.push("open");
      }
    );
    store().set("/alpha/src/new.rs", "created elsewhere");

    expect(await reloadCurrentFromDisk()).toBe("reopened");
    expect(order).toEqual(["switch", "drop", "open"]);
  });

  it("waits to re-open while a model holds unsaved keystrokes", async () => {
    store().set("/alpha/src/new.rs", "created elsewhere");
    (PgEditorModels.anyEditedUnder as Mock).mockResolvedValue(true);

    expect(await reloadCurrentFromDisk()).toBe("deferred");
    expect(PgEditorModels.anyEditedUnder).toHaveBeenCalledWith(
      "/alpha/",
      expect.any(Function)
    );
    expect(PgExplorer.switchWorkspace).not.toHaveBeenCalled();
    expect(PgEditorModels.dropUnder).not.toHaveBeenCalled();
  });

  it("re-opens even when another tab changed the project list", async () => {
    // The list is re-read first, so the switch saves the store's list back
    // rather than the one this tab loaded with. That was a deferral, which
    // left the tree behind until the tab was loaded again.
    store().set("/alpha/src/new.rs", "created elsewhere");
    store().set(
      PgWorkspace.WORKSPACES_CONFIG_PATH,
      JSON.stringify({
        workspaces: [
          { id: "a1", name: "alpha" },
          { id: "b1", name: "beta" },
        ],
        currentId: "b1",
      })
    );
    vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue(["alpha"]);
    vi.spyOn(PgExplorer, "workspaceIdOf").mockReturnValue("a1");

    expect(await reloadCurrentFromDisk()).toBe("reopened");
    expect(PgExplorer.refreshWorkspaces).toHaveBeenCalled();
    expect(PgExplorer.switchWorkspace).toHaveBeenCalledWith("alpha");
  });

  it("follows a rename made in another tab", async () => {
    // The list is re-read before the name is: this tab keeps its workspace
    // by id, so after the re-read it goes by the new name
    store().clear();
    store().set("/renamed/src/lib.rs", "old");
    const name = vi.spyOn(PgExplorer, "currentWorkspaceName", "get");
    (PgExplorer.refreshWorkspaces as Mock).mockImplementation(async () => {
      name.mockReturnValue("renamed");
      return true;
    });

    expect(await reloadCurrentFromDisk()).toBe("reopened");
    expect(PgExplorer.switchWorkspace).toHaveBeenCalledWith("renamed");
    // Nothing to wait for: autosave under the old name can no longer land
    expect(PgEditorModels.anyEditedUnder).not.toHaveBeenCalled();
    expect(PgEditorModels.dropUnder).toHaveBeenCalledWith(
      "/renamed/",
      expect.any(Function)
    );
    expect(PgEditorModels.dropUnder).toHaveBeenCalledWith("/alpha/");
  });

  it("leaves this tab's own switch alone while it is half-way", async () => {
    // `switchWorkspace` names the new current one before it loads the tree,
    // so for a moment the current id is not the one the tree was opened
    // under. That is not a rename, and carrying the tree across would write
    // one project's files into another's.
    vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue([
      "alpha",
      "beta",
    ]);
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue("beta");
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue("b1");
    store().set("/beta/src/lib.rs", "// fresh template");
    (PgEditorModels.valueOf as Mock).mockResolvedValue("typed in alpha");
    const writes = vi.spyOn(PgFs, "writeFile");

    expect(await reloadCurrentFromDisk()).toBe("skipped");
    expect(writes).not.toHaveBeenCalled();
    expect(store().get("/beta/src/lib.rs")).toBe("// fresh template");
    expect(PgExplorer.switchWorkspace).not.toHaveBeenCalled();
  });

  it("follows a rename though a new project took the old name", async () => {
    // Another tab renamed alpha to beta, then created a new "alpha". By name
    // the tree's "alpha" is still listed and reads as a switch half-way; by
    // id this workspace -- a1 -- was renamed, and the new alpha is not it.
    store().clear();
    store().set("/beta/src/lib.rs", "old");
    store().set("/alpha/src/lib.rs", "// someone else's new project");
    vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue([
      "beta",
      "alpha",
    ]);
    const name = vi.spyOn(PgExplorer, "currentWorkspaceName", "get");
    (PgExplorer.refreshWorkspaces as Mock).mockImplementation(async () => {
      name.mockReturnValue("beta");
      return true;
    });
    (PgEditorModels.valueOf as Mock).mockResolvedValue("typed");

    expect(await reloadCurrentFromDisk()).toBe("reopened");
    expect(PgExplorer.switchWorkspace).toHaveBeenCalledWith("beta");
    expect(store().get("/beta/src/lib.rs")).toBe("typed");
    expect(store().get("/alpha/src/lib.rs")).toBe(
      "// someone else's new project"
    );
  });

  it("waits while its own change to the list is unsaved", async () => {
    // Deferred rather than skipped: whatever asked for this reload still
    // needs it, and is told to ask again
    (PgExplorer.refreshWorkspaces as Mock).mockResolvedValue(false);
    store().set("/alpha/src/new.rs", "created elsewhere");

    expect(await reloadCurrentFromDisk()).toBe("deferred");
    expect(PgExplorer.switchWorkspace).not.toHaveBeenCalled();
  });

  it("carries a file with no record across a rename", async () => {
    // Created in this tab since the open, so there is no record of what it
    // had on disk, and a failed first autosave left its text only in state
    store().clear();
    store().set("/renamed/src/lib.rs", "old");
    store().set("/renamed/src/moved.rs", "");
    memory["/alpha/src/moved.rs"] = { content: "// typed, never written" };
    const name = vi.spyOn(PgExplorer, "currentWorkspaceName", "get");
    (PgExplorer.refreshWorkspaces as Mock).mockImplementation(async () => {
      name.mockReturnValue("renamed");
      return true;
    });

    expect(await reloadCurrentFromDisk()).toBe("reopened");
    expect(store().get("/renamed/src/moved.rs")).toBe(
      "// typed, never written"
    );
    // Recorded at the open and unchanged since: not this tab's to write
    expect(store().get("/renamed/src/lib.rs")).toBe("old");
  });

  it("keeps a file's record through a rename in this tab", async () => {
    // Renamed here after the open: the same item under a new path. The
    // neighbour then edits it and renames the workspace. This tab changed
    // nothing in it, so its old copy must not go over that edit.
    memory["/alpha/src/moved.rs"] = memory["/alpha/src/lib.rs"];
    delete memory["/alpha/src/lib.rs"];
    PgCommon.createAndDispatchCustomEvent(
      PgExplorer.events.ON_DID_RENAME_ITEM,
      "/alpha/src/lib.rs"
    );
    store().clear();
    store().set("/renamed/src/moved.rs", "// the neighbour's edit");
    const name = vi.spyOn(PgExplorer, "currentWorkspaceName", "get");
    (PgExplorer.refreshWorkspaces as Mock).mockImplementation(async () => {
      name.mockReturnValue("renamed");
      return true;
    });

    expect(await reloadCurrentFromDisk()).toBe("reopened");
    expect(store().get("/renamed/src/moved.rs")).toBe(
      "// the neighbour's edit"
    );
  });

  it("carries nothing of a temporary project into a workspace", async () => {
    // A shared link's tree is `/src/...`, and saving it as a workspace moves
    // those items under the new name. Half-way, that tree reads as held
    // under "src" -- never opened, and not listed.
    memory = { "/src/lib.rs": { content: "// shared" } };
    vi.spyOn(PgExplorer, "isTemporary", "get").mockReturnValue(true);
    PgCommon.createAndDispatchCustomEvent(PgExplorer.events.ON_DID_INIT);
    vi.spyOn(PgExplorer, "isTemporary", "get").mockReturnValue(false);
    vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue(["mine"]);
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue("mine");
    store().set("/mine/src/lib.rs", "// template");
    const writes = vi.spyOn(PgFs, "writeFile");

    expect(await reloadCurrentFromDisk()).toBe("skipped");
    expect(writes).not.toHaveBeenCalled();
    expect(PgExplorer.switchWorkspace).not.toHaveBeenCalled();
  });

  it("leaves a temporary project alone while it is saved as a workspace", async () => {
    // A tab that opened a shared link straight away, with no workspace
    // before it. Saving the link moves its items under the new name and
    // then writes them one by one; a reload in between found the tree under
    // the current name, half of it on disk, and re-opened it -- reading the
    // half back over the files the save had yet to write.
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue(
      undefined
    );
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue(
      undefined
    );
    PgCommon.createAndDispatchCustomEvent(
      PgExplorer.events.ON_DID_SWITCH_WORKSPACE
    );
    memory = { "/src/lib.rs": { content: "// shared" } };
    vi.spyOn(PgExplorer, "isTemporary", "get").mockReturnValue(true);
    PgCommon.createAndDispatchCustomEvent(PgExplorer.events.ON_DID_INIT);

    vi.spyOn(PgExplorer, "isTemporary", "get").mockReturnValue(false);
    memory = {
      "/mine/src/lib.rs": { content: "// shared" },
      "/mine/src/util.rs": { content: "// not written yet" },
    };
    vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue(["mine"]);
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue("mine");
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue("m1");
    store().clear();
    store().set("/mine/src/lib.rs", "// shared");

    expect(await reloadCurrentFromDisk()).toBe("skipped");
    expect(PgExplorer.switchWorkspace).not.toHaveBeenCalled();
  });

  it("records what a write carried, not state when heard", async () => {
    // A second autosave has put newer text into state by the time the first
    // write's event is heard -- and its own write then fails, the directory
    // having moved. Recorded from state, the newer text would look written.
    memory["/alpha/src/lib.rs"].content = "second";
    PgCommon.createAndDispatchCustomEvent(PgFs.events.ON_DID_WRITE_FILE, {
      path: "/alpha/src/lib.rs",
      data: "first",
    });
    store().clear();
    store().set("/renamed/src/lib.rs", "first");
    const name = vi.spyOn(PgExplorer, "currentWorkspaceName", "get");
    (PgExplorer.refreshWorkspaces as Mock).mockImplementation(async () => {
      name.mockReturnValue("renamed");
      return true;
    });

    expect(await reloadCurrentFromDisk()).toBe("reopened");
    expect(store().get("/renamed/src/lib.rs")).toBe("second");
  });

  it("carries typing under the old name across a rename", async () => {
    store().clear();
    store().set("/renamed/src/lib.rs", "old");
    const name = vi.spyOn(PgExplorer, "currentWorkspaceName", "get");
    (PgExplorer.refreshWorkspaces as Mock).mockImplementation(async () => {
      name.mockReturnValue("renamed");
      return true;
    });
    (PgEditorModels.valueOf as Mock).mockResolvedValue("typed");

    expect(await reloadCurrentFromDisk()).toBe("reopened");
    expect(store().get("/renamed/src/lib.rs")).toBe("typed");
  });

  describe("when another tab deleted the open workspace", () => {
    beforeEach(() => {
      // The id is kept through a refresh; it is the name that goes
      vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue("a1");
      vi.spyOn(PgExplorer, "init").mockResolvedValue(undefined);
      const name = vi.spyOn(PgExplorer, "currentWorkspaceName", "get");
      (PgExplorer.refreshWorkspaces as Mock).mockImplementation(async () => {
        name.mockReturnValue(undefined);
        return true;
      });
      store().clear();
    });

    it("moves to the last workspace left, as the deleter did", async () => {
      vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue([
        "beta",
        "gamma",
      ]);

      expect(await reloadCurrentFromDisk()).toBe("reopened");
      expect(PgExplorer.switchWorkspace).toHaveBeenCalledWith("gamma");
      expect(PgEditorModels.dropUnder).toHaveBeenCalledWith(
        "/alpha/",
        expect.any(Function)
      );
    });

    it("shows the empty state when none are left", async () => {
      vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue([]);

      expect(await reloadCurrentFromDisk()).toBe("reopened");
      expect(PgExplorer.switchWorkspace).not.toHaveBeenCalled();
      // `init` is what clears the deleted workspace's tree and tabs, and
      // what the sidebar and the gallery listen for
      expect(PgExplorer.init).toHaveBeenCalledWith();
      // Not the delete event: sync would delete the project a second time
      expect(dispatched()).not.toContain(
        PgExplorer.events.ON_DID_DELETE_WORKSPACE
      );
      expect(PgEditorModels.dropUnder).toHaveBeenCalledWith(
        "/alpha/",
        expect.any(Function)
      );
    });

    it("leaves a lesson's route when none are left", async () => {
      vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue([]);
      vi.spyOn(PgRouter, "navigate").mockResolvedValue(undefined);
      window.history.pushState({}, "", "/tutorials/hello-anchor");

      expect(await reloadCurrentFromDisk()).toBe("reopened");
      expect(PgRouter.navigate).toHaveBeenCalledWith();
      window.history.pushState({}, "", "/");
    });

    it("does it once: a tab that has left is left alone", async () => {
      vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue([]);

      expect(await reloadCurrentFromDisk()).toBe("reopened");
      expect(await reloadCurrentFromDisk()).toBe("skipped");
      expect(PgExplorer.init).toHaveBeenCalledTimes(1);
    });

    it("leaves a workspace with no files of its own too", async () => {
      // Nothing in the tree to name it: the name it was opened under does
      memory = {};
      vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue([
        "beta",
      ]);

      expect(await reloadCurrentFromDisk()).toBe("reopened");
      expect(PgExplorer.switchWorkspace).toHaveBeenCalledWith("beta");
    });

    it("puts it back when the directory is still there", async () => {
      // Then the list was saved by a tab that had not seen this workspace,
      // not by a delete -- which removes the directory first
      store().set("/alpha/src/lib.rs", "old");
      vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue([
        "beta",
      ]);
      vi.spyOn(PgExplorer, "importWorkspace").mockResolvedValue(undefined);

      expect(await reloadCurrentFromDisk()).toBe("unchanged");
      expect(PgExplorer.importWorkspace).toHaveBeenCalledWith("alpha", {
        id: "a1",
        files: {},
      });
      expect(PgExplorer.switchWorkspace).not.toHaveBeenCalled();
      // Put back is the repair working, not a failure
      expect(getFailures()).toEqual([]);
    });

    it("leaves it as deleted when it cannot be put back", async () => {
      // Its name is taken on the list that lost it. Staying put is the state
      // the sidebar throws on: workspaces listed, none current.
      store().set("/alpha/src/lib.rs", "old");
      vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue([
        "alpha",
        "beta",
      ]);
      vi.spyOn(PgExplorer, "importWorkspace").mockRejectedValue(
        new Error("name taken")
      );

      expect(await reloadCurrentFromDisk()).toBe("reopened");
      expect(PgExplorer.switchWorkspace).toHaveBeenCalledWith("beta");
      expect(getFailures()).toEqual([
        expect.objectContaining({ what: "reload alpha: put back" }),
      ]);
    });

    it("does not put back a directory holding only the tabs file", async () => {
      // `saveMeta` recreates it around that one file in a tab that has not
      // yet heard of the delete. Read as "still there", that undid the
      // delete in every tab.
      store().set("/alpha/.workspace/metadata.json", '{"tabs":[]}');
      vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue([
        "beta",
      ]);
      vi.spyOn(PgExplorer, "importWorkspace").mockResolvedValue(undefined);

      expect(await reloadCurrentFromDisk()).toBe("reopened");
      expect(PgExplorer.importWorkspace).not.toHaveBeenCalled();
      expect(PgExplorer.switchWorkspace).toHaveBeenCalledWith("beta");
    });

    it("puts back a directory with a workspace file besides the tabs", async () => {
      // The keypair is the project's, and only a delete takes it
      store().set("/alpha/.workspace/metadata.json", '{"tabs":[]}');
      store().set("/alpha/.workspace/program-info.json", '{"kp":[1]}');
      vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue([
        "beta",
      ]);
      vi.spyOn(PgExplorer, "importWorkspace").mockResolvedValue(undefined);

      expect(await reloadCurrentFromDisk()).toBe("unchanged");
      expect(PgExplorer.importWorkspace).toHaveBeenCalled();
    });

    it("moves into a project a neighbour creates after leaving", async () => {
      // Left, with nothing listed. A neighbour's create then lists one while
      // the current id still names the deleted workspace -- workspaces
      // listed and none current, which the sidebar throws on.
      const names = vi
        .spyOn(PgExplorer, "allWorkspaceNames", "get")
        .mockReturnValue([]);
      expect(await reloadCurrentFromDisk()).toBe("reopened");
      (PgEditorModels.dropUnder as Mock).mockClear();

      names.mockReturnValue(["created-elsewhere"]);
      expect(await reloadCurrentFromDisk()).toBe("reopened");
      expect(PgExplorer.switchWorkspace).toHaveBeenCalledWith(
        "created-elsewhere"
      );
      // Its models went with the first leave
      expect(PgEditorModels.dropUnder).not.toHaveBeenCalled();
      expect(PgExplorer.init).toHaveBeenCalledTimes(1);
    });
  });

  it("runs the next reload after one that threw", async () => {
    // Queued one behind another, so a rejection passed down the chain would
    // stop every reload this tab asks for from then on
    (PgExplorer.refreshWorkspaces as Mock).mockRejectedValueOnce(
      new Error("store gone away")
    );
    const first = reloadCurrentFromDisk();
    const second = reloadCurrentFromDisk();

    await expect(first).rejects.toThrow("store gone away");
    expect(await second).toBe("unchanged");
  });

  it("re-opens on request over unsaved keystrokes", async () => {
    // `adopt`: the user has chosen to discard this tab's copy
    (PgEditorModels.anyEditedUnder as Mock).mockResolvedValue(true);

    expect(await reloadCurrentFromDisk({ reopen: true })).toBe("reopened");
    expect(PgExplorer.switchWorkspace).toHaveBeenCalledWith("alpha");
  });

  it("re-opens on request even when nothing differs", async () => {
    expect(await reloadCurrentFromDisk({ reopen: true })).toBe("reopened");
    expect(PgExplorer.switchWorkspace).toHaveBeenCalledWith("alpha");
  });

  it("ignores dotfiles, which the in-memory tree never holds", async () => {
    store().set("/alpha/.workspace/program-info.json", "{}");

    expect(await reloadCurrentFromDisk()).toBe("unchanged");
  });

  it("skips a temporary workspace, which has nothing on disk", async () => {
    vi.spyOn(PgExplorer, "isTemporary", "get").mockReturnValue(true);
    store().set("/alpha/src/lib.rs", "irrelevant");

    expect(await reloadCurrentFromDisk()).toBe("skipped");
  });

  it("skips when the workspace directory is gone", async () => {
    // Renamed or deleted in the other tab: recreating it would be worse
    store().clear();

    expect(await reloadCurrentFromDisk()).toBe("skipped");
    expect(PgExplorer.switchWorkspace).not.toHaveBeenCalled();
    // The expected case, so not a failure
    expect(getFailures()).toEqual([]);
  });

  it("reports a store that fails to read, and skips", async () => {
    vi.spyOn(PgFs, "readDir").mockRejectedValueOnce(
      new Error("QuotaExceededError")
    );

    expect(await reloadCurrentFromDisk()).toBe("skipped");
    expect(getFailures()).toEqual([
      expect.objectContaining({ what: "reload /alpha: read" }),
    ]);
  });
});
