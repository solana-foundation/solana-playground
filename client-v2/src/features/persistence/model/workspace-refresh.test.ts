import type { Mock } from "vitest";
import { PgEditorModels } from "./editor-models";
import { reconcile } from "./project-restore";
import { reloadCurrentFromDisk } from "./tab-reload";
import { tabSync } from "../../../effects/tab-sync/tab-sync";
import { PgExplorer } from "../../../utils/explorer/explorer";
import { PgWorkspace } from "../../../utils/explorer/workspace";

/**
 * Another tab renames or deletes the workspace this one has open, and this
 * one hears of it the two ways it can: the channel, and a reconcile.
 *
 * Nothing is stubbed between the message and the store -- the real reload
 * re-reads the real list over the in-memory filesystem. The unit tests of
 * each piece passed while the pieces together did not: the list used to be
 * re-read before the reload started, so the reload never saw the change it
 * was meant to act on.
 */

vi.mock("./editor-models", () => ({
  PgEditorModels: {
    valueOf: vi.fn(async () => null),
    drop: vi.fn(async () => {}),
    dropUnder: vi.fn(async () => {}),
    anyEditedUnder: vi.fn(async () => false),
  },
}));

const store = () =>
  (PgExplorer.fs as unknown as { __files: Map<string, string> }).__files;

const opened: FakeChannel[] = [];
class FakeChannel {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(public name: string) {
    opened.push(this);
  }
  postMessage() {}
  close() {}
}

type Config = {
  workspaces: Array<{ id: string; name: string }>;
  currentId?: string;
};
const config = () =>
  JSON.parse(store().get(PgWorkspace.WORKSPACES_CONFIG_PATH)!) as Config;

/** What the other tab leaves in the store, and nothing in this tab's memory */
const elsewhere = {
  rename(from: string, to: string) {
    for (const [path, content] of [...store().entries()]) {
      if (!path.startsWith(`/${from}/`)) continue;
      store().delete(path);
      store().set(`/${to}/` + path.slice(from.length + 2), content);
    }
    const next = config();
    next.workspaces = next.workspaces.map((w) =>
      w.name === from ? { id: w.id, name: to } : w
    );
    store().set(PgWorkspace.WORKSPACES_CONFIG_PATH, JSON.stringify(next));
  },
  delete(name: string) {
    for (const path of [...store().keys()]) {
      if (path.startsWith(`/${name}/`)) store().delete(path);
    }
    const next = config();
    next.workspaces = next.workspaces.filter((w) => w.name !== name);
    next.currentId = next.workspaces.at(-1)?.id;
    store().set(PgWorkspace.WORKSPACES_CONFIG_PATH, JSON.stringify(next));
  },
};

/** The channel: a neighbour's list message, then whatever reload it runs */
const viaChannel = async () => {
  const effect = tabSync();
  opened.forEach((channel) =>
    channel.onmessage?.({ data: { type: "workspaces-written", from: "x" } })
  );
  await new Promise((done) => setTimeout(done, 400));
  // Queued behind the one the message started, so this waits for it
  await reloadCurrentFromDisk();
  effect.dispose();
};

const viaReconcile = async () => {
  await reconcile();
};

const paths = () => Object.keys(PgExplorer.files).filter((p) => p !== "/");

beforeEach(async () => {
  store().clear();
  opened.length = 0;
  Object.defineProperty(globalThis, "BroadcastChannel", {
    value: FakeChannel,
    configurable: true,
  });
  (PgEditorModels.valueOf as Mock).mockResolvedValue(null);
  (PgEditorModels.anyEditedUnder as Mock).mockResolvedValue(false);
  (PgEditorModels.dropUnder as Mock).mockImplementation(
    async (_prefix: string, then?: () => void) => then?.()
  );

  const statics = PgExplorer as unknown as {
    _workspace: unknown;
    _initializedWorkspaceName: unknown;
  };
  statics._workspace = null;
  statics._initializedWorkspaceName = null;
  await PgExplorer.init();
  await PgExplorer.createWorkspace("alpha", {
    files: [["/alpha/src/lib.rs", "// alpha"]],
  });
  await PgExplorer.createWorkspace("beta", {
    files: [["/beta/src/lib.rs", "// beta"]],
  });
});

const ways: Array<[string, () => Promise<void>]> = [
  ["the channel", viaChannel],
  ["a reconcile", viaReconcile],
];

for (const [how, hear] of ways)
  describe(`heard through ${how}`, () => {
    it("follows a rename made in another tab", async () => {
      const id = PgExplorer.currentWorkspaceId;
      elsewhere.rename("beta", "renamed");

      await hear();

      expect(PgExplorer.currentWorkspaceId).toBe(id);
      expect(PgExplorer.currentWorkspaceName).toBe("renamed");
      expect(paths().every((p) => p.startsWith("/renamed/"))).toBe(true);
      // The old name's models are dropped
      expect(PgEditorModels.dropUnder).toHaveBeenCalledWith("/beta/");
      // And a save now carries the other tab's list, not this one's old copy
      expect(config().workspaces.map((w) => w.name)).toEqual([
        "alpha",
        "renamed",
      ]);
    });

    it("carries unsaved typing under the old name into the new", async () => {
      // Autosave writes under the old name, which is gone, so waiting for it
      // would wait forever -- and the re-open after it lost the text
      (PgEditorModels.valueOf as Mock).mockImplementation(
        async (path: string) =>
          path === "/beta/src/lib.rs" ? "// typed" : null
      );
      elsewhere.rename("beta", "renamed");

      await hear();

      expect(store().get("/renamed/src/lib.rs")).toBe("// typed");
      expect(PgExplorer.files["/renamed/src/lib.rs"].content).toBe("// typed");
      expect(store().has("/beta/src/lib.rs")).toBe(false);
    });

    it("carries a failed autosave's text too", async () => {
      // In state but never written: its directory had moved
      PgExplorer.files["/beta/src/lib.rs"].content = "// saved to state";
      elsewhere.rename("beta", "renamed");

      await hear();

      expect(store().get("/renamed/src/lib.rs")).toBe("// saved to state");
      expect(PgExplorer.files["/renamed/src/lib.rs"].content).toBe(
        "// saved to state"
      );
    });

    it("moves on from a workspace deleted in another tab", async () => {
      elsewhere.delete("beta");

      await hear();

      expect(PgExplorer.currentWorkspaceName).toBe("alpha");
      expect(paths().every((p) => p.startsWith("/alpha/"))).toBe(true);
      expect(PgEditorModels.dropUnder).toHaveBeenCalledWith(
        "/beta/",
        expect.any(Function)
      );
      expect(config().workspaces.map((w) => w.name)).toEqual(["alpha"]);
      // Not brought back
      expect(store().has("/beta/src/lib.rs")).toBe(false);
    });

    it("does not write its old copy over a neighbour's edit", async () => {
      // The neighbour edits, then renames. This tab never took the edit, and
      // its copy is only old -- nothing of its own to carry.
      store().set("/beta/src/lib.rs", "// the neighbour's edit");
      elsewhere.rename("beta", "renamed");

      await hear();

      expect(store().get("/renamed/src/lib.rs")).toBe(
        "// the neighbour's edit"
      );
      expect(PgExplorer.files["/renamed/src/lib.rs"].content).toBe(
        "// the neighbour's edit"
      );
    });

    it("carries only its own typing past a neighbour's edit", async () => {
      store().set("/beta/src/other.rs", "// other");
      await PgExplorer.switchWorkspace("beta");
      (PgEditorModels.valueOf as Mock).mockImplementation(
        async (path: string) =>
          path === "/beta/src/lib.rs" ? "// typed" : null
      );
      store().set("/beta/src/other.rs", "// the neighbour's edit");
      elsewhere.rename("beta", "renamed");

      await hear();

      expect(store().get("/renamed/src/lib.rs")).toBe("// typed");
      expect(store().get("/renamed/src/other.rs")).toBe(
        "// the neighbour's edit"
      );
    });

    it("puts back a workspace a stale list left off", async () => {
      // The directory is still there: not a delete, but a list saved by a tab
      // that had not seen this workspace
      const id = PgExplorer.currentWorkspaceId;
      const next = config();
      next.workspaces = next.workspaces.filter((w) => w.name !== "beta");
      store().set(PgWorkspace.WORKSPACES_CONFIG_PATH, JSON.stringify(next));

      await hear();

      expect(PgExplorer.currentWorkspaceName).toBe("beta");
      expect(PgExplorer.currentWorkspaceId).toBe(id);
      expect(config().workspaces).toContainEqual({ id, name: "beta" });
    });

    it("moves into a project created elsewhere once it has left", async () => {
      elsewhere.delete("alpha");
      elsewhere.delete("beta");
      await hear();

      // A neighbour creates one, while this tab's kept id still names the
      // deleted one: workspaces listed and none current, which the sidebar
      // throws on. So it goes where the deleting tab would have gone.
      const next = config();
      next.workspaces = [{ id: "n1", name: "fresh" }];
      next.currentId = "n1";
      store().set(PgWorkspace.WORKSPACES_CONFIG_PATH, JSON.stringify(next));
      store().set("/fresh/src/lib.rs", "// fresh");
      await hear();

      expect(PgExplorer.allWorkspaceNames).toEqual(["fresh"]);
      expect(PgExplorer.currentWorkspaceName).toBe("fresh");
      expect(paths()).toContain("/fresh/src/lib.rs");
    });

    it("empties the tree when the last one was deleted", async () => {
      elsewhere.delete("alpha");
      elsewhere.delete("beta");

      await hear();

      expect(PgExplorer.allWorkspaceNames).toEqual([]);
      expect(paths()).toEqual([]);
      expect(PgExplorer.tabs).toEqual([]);
    });
  });
