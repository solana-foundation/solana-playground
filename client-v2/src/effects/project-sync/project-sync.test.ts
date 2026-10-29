import type { MockInstance } from "vitest";
import { projectSync } from "./project-sync";
import { PgAccountList } from "../../features/persistence/model/account-list";
import { PgProjectSync } from "../../features/persistence/model/project-sync";
import * as restore from "../../features/persistence/model/project-restore";
import * as snapshot from "../../features/persistence/model/snapshot";
import { PgSyncBase } from "../../features/persistence/model/sync-base";
import { PgSyncClaim } from "../../features/persistence/model/sync-claim";
import { PgSyncMark } from "../../features/persistence/model/sync-mark";
import { PgThreadIndex } from "../../features/persistence/model/thread-index";
import { PgCommon } from "../../utils/common";
import { PgExplorer } from "../../utils/explorer/explorer";
import { PgFs } from "../../utils/explorer/fs";
import { PgWorkspace } from "../../utils/explorer/workspace";
import type { CreatedWorkspace } from "../../utils/explorer/types";
import type { Disposable } from "../../utils/types";

/**
 * What this effect subscribes to is the whole of its job.
 *
 * It was subscribed to file changes alone, so a project reached the server
 * only by being typed in: opening one, or signing in with one already open,
 * left it on this device however long you looked at it. That is not visible in
 * a test of `PgProjectSync`, which was correct throughout -- nothing called it.
 *
 * The visibility half is the other side of the same coin. A tab that has been
 * in the background holds a stale in-memory copy of the current workspace, and
 * anything that nudges it uploads that copy over whatever has happened since.
 */

const dispatch = (event: string) =>
  PgCommon.createAndDispatchCustomEvent(event);

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("the project-sync effect", () => {
  let push: MockInstance;
  let effect: Disposable | null;

  beforeEach(() => {
    vi.useFakeTimers();
    effect = null;
    push = vi
      .spyOn(PgProjectSync, "pushCurrent")
      .mockResolvedValue("ok" as never);
    vi.spyOn(PgSyncMark, "markDirty").mockResolvedValue(undefined);
    vi.spyOn(PgSyncMark, "projectIds").mockResolvedValue([]);
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue(
      "p1" as never
    );
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue(
      "one" as never
    );
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  afterEach(() => {
    // Disposed here rather than at the end of each test: an assertion that
    // fails before its own `dispose()` leaves the effect subscribed, and the
    // next test sees its pushes
    effect?.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("still uploads on an edit", () => {
    effect = projectSync();

    dispatch(PgExplorer.events.ON_DID_SAVE_FILE);
    vi.advanceTimersByTime(3000);

    expect(push).toHaveBeenCalled();
  });

  it("claims a workspace the user creates, not one sync imports", () => {
    // A tutorial started here has the id another account's copy had; the
    // claim is what lets its pushes go up. An import gets a mark from sync.
    const claim = vi.spyOn(PgSyncClaim, "claim").mockResolvedValue(undefined);
    effect = projectSync();

    PgCommon.createAndDispatchCustomEvent<CreatedWorkspace>(
      PgExplorer.events.ON_DID_CREATE_WORKSPACE,
      { id: "tut:hello", imported: false }
    );
    PgCommon.createAndDispatchCustomEvent<CreatedWorkspace>(
      PgExplorer.events.ON_DID_CREATE_WORKSPACE,
      { id: "p9", imported: true }
    );

    expect(claim.mock.calls).toEqual([["tut:hello"]]);
  });

  it("collapses a burst of edits into one upload", () => {
    effect = projectSync();

    dispatch(PgExplorer.events.ON_DID_SAVE_FILE);
    dispatch(PgExplorer.events.ON_DID_SAVE_FILE);
    dispatch(PgExplorer.events.ON_DID_SAVE_FILE);
    vi.advanceTimersByTime(3000);

    expect(push).toHaveBeenCalledTimes(1);
  });

  it("flushes a pending edit when the user leaves the project", () => {
    // Otherwise the debounce is simply cancelled by the switch and the edit
    // waits for the next reconcile to notice it
    effect = projectSync();

    dispatch(PgExplorer.events.ON_DID_SAVE_FILE);
    dispatch(PgExplorer.events.ON_DID_SWITCH_WORKSPACE);

    expect(push).toHaveBeenCalledTimes(1);

    // ...and does not then blind-push the incoming project on a timer. What
    // the incoming project needs is a reconcile, which may well mean pulling
    // rather than pushing -- covered in "opening a project" below.
    vi.advanceTimersByTime(3000);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("uploads tutorial progress and the program keypair", () => {
    // These three files are written straight to `PgFs` by `PgTutorial` and
    // `PgProgramInfo`, not through `saveFileToState`, so none of the explorer
    // events fires for them. They are also exactly the files the snapshot
    // deliberately carries -- so the only files sync exists to move were the
    // only ones nothing ever scheduled an upload for, and a tutorial's page
    // number reached the server only if some unrelated edit happened later.
    effect = projectSync();

    for (const path of [
      "/Hello Seahorse/.tutorial.json",
      "/Hello Seahorse/.workspace/tutorial-storage.json",
      "/Hello Seahorse/.workspace/program-info.json",
    ]) {
      PgCommon.createAndDispatchCustomEvent(PgFs.events.ON_DID_WRITE_FILE, {
        path,
        data: "",
      });
    }
    vi.advanceTimersByTime(3000);

    expect(push).toHaveBeenCalledTimes(1);
  });

  it("ignores a direct write of anything that is not synced", () => {
    // `saveMeta` rewrites the tab state constantly, and the snapshot filters
    // it out on purpose -- scheduling for it would be pure churn
    effect = projectSync();

    PgCommon.createAndDispatchCustomEvent(PgFs.events.ON_DID_WRITE_FILE, {
      path: "/Hello Seahorse/.workspace/metadata.json",
      data: "[]",
    });
    vi.advanceTimersByTime(3000);

    expect(push).not.toHaveBeenCalled();
  });

  it("flags and reconciles a project renamed from the switcher, not the open one", async () => {
    // A rename of a workspace the user is not in: its row has not moved and
    // its mark is clean, so without the flag reconcile's cheap path skips it
    // and the new name never reaches the account
    const pass = vi.spyOn(restore, "reconcile").mockResolvedValue({
      imported: [],
      replaced: [],
      removed: [],
      pushed: [],
      conflicts: [],
      latest: null,
    });
    effect = projectSync();

    PgCommon.createAndDispatchCustomEvent(
      PgExplorer.events.ON_DID_RENAME_WORKSPACE,
      { id: "p2" }
    );
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(PgSyncMark.markDirty).toHaveBeenCalledWith("p2");
    expect(PgSyncMark.markDirty).not.toHaveBeenCalledWith("p1");
    expect(pass).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("treats a rename of the open project as an edit", () => {
    effect = projectSync();

    dispatch(PgExplorer.events.ON_DID_RENAME_WORKSPACE);

    expect(PgSyncMark.markDirty).toHaveBeenCalledWith("p1");
    vi.advanceTimersByTime(3000);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("records an edit before attempting to upload it", () => {
    // Written first, so a tab closed or crashed between the keystroke and the
    // request still reads as having unsaved work on the next load
    effect = projectSync();

    dispatch(PgExplorer.events.ON_DID_SAVE_FILE);

    expect(PgSyncMark.markDirty).toHaveBeenCalledWith("p1");
    expect(push).not.toHaveBeenCalled();
  });

  it("remembers the files a project opened with, so an edit has a base", async () => {
    vi.spyOn(snapshot, "snapshotOf").mockResolvedValue({
      files: { "src/lib.rs": "opened with" },
    } as never);
    const track = vi.spyOn(PgSyncBase, "track");
    vi.spyOn(restore, "reconcile").mockResolvedValue({
      imported: [],
      replaced: [],
      removed: [],
      pushed: [],
      conflicts: [],
      latest: null,
    });
    effect = projectSync();

    dispatch(PgExplorer.events.ON_DID_SWITCH_WORKSPACE);
    // Three turns of the microtask queue: `snapshotOf` and the async
    // wrapper around it, then `track`. Awaited one by one so the count is
    // on the page; `vi.advanceTimersByTimeAsync(0)` would drain them too.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(track).toHaveBeenCalledWith("p1", { "src/lib.rs": "opened with" });
  });

  it("remembers the files of the project already open when it starts", async () => {
    vi.spyOn(snapshot, "snapshotOf").mockResolvedValue({
      files: { "src/lib.rs": "opened with" },
    } as never);
    // A fresh page: nothing held yet
    PgSyncBase.reset();
    const track = vi.spyOn(PgSyncBase, "track");

    // Mounted after the page load's switch has fired: `<Effects />` is
    // delayed, so no switch event reaches it for the project on screen
    effect = projectSync();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(track).toHaveBeenCalledWith("p1", { "src/lib.rs": "opened with" });
  });

  it("keeps a shadow an upload took before its own read landed", async () => {
    vi.spyOn(snapshot, "snapshotOf").mockResolvedValue({
      files: { "src/lib.rs": "edited since" },
    } as never);
    PgSyncBase.track("p1", { "src/lib.rs": "agreed" });
    const track = vi.spyOn(PgSyncBase, "track");

    effect = projectSync();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(track).not.toHaveBeenCalled();
  });
});

describe("a tab that is not in front", () => {
  let push: MockInstance;
  let effect: Disposable | null;

  beforeEach(() => {
    vi.useFakeTimers();
    effect = null;
    push = vi
      .spyOn(PgProjectSync, "pushCurrent")
      .mockResolvedValue("ok" as never);
    vi.spyOn(PgSyncMark, "markDirty").mockResolvedValue(undefined);
    vi.spyOn(PgSyncMark, "projectIds").mockResolvedValue([]);
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue(
      "p1" as never
    );
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue(
      "one" as never
    );
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  afterEach(() => {
    effect?.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("records the edit but does not upload it", () => {
    effect = projectSync();
    setVisibility("hidden");

    dispatch(PgExplorer.events.ON_DID_SAVE_FILE);
    vi.advanceTimersByTime(10000);

    expect(PgSyncMark.markDirty).toHaveBeenCalledWith("p1");
    expect(push).not.toHaveBeenCalled();
  });

  it("flushes what it had pending as it goes to the background", () => {
    // The document is still alive at this point, so an ordinary fetch
    // completes -- unlike the `beforeunload` flush this replaces, which
    // browsers cancel along with the page
    effect = projectSync();

    dispatch(PgExplorer.events.ON_DID_SAVE_FILE);
    setVisibility("hidden");

    expect(push).toHaveBeenCalledTimes(1);
  });

  it("reconciles before it is allowed to push again", async () => {
    const order: string[] = [];
    vi.spyOn(PgProjectSync, "holdPushes").mockImplementation(() =>
      order.push("hold")
    );
    vi.spyOn(PgProjectSync, "releasePushes").mockImplementation(() =>
      order.push("release")
    );
    vi.spyOn(restore, "reconcile").mockImplementation(async () => {
      order.push("reconcile");
      return {
        imported: [],
        replaced: [],
        removed: [],
        pushed: [],
        conflicts: [],
        latest: null,
      };
    });

    effect = projectSync();
    setVisibility("hidden");
    setVisibility("visible");
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(["hold", "reconcile", "release"]);
  });
});

describe("opening a project", () => {
  let effect: Disposable | null;

  beforeEach(() => {
    effect = null;
    vi.spyOn(PgProjectSync, "pushCurrent").mockResolvedValue("ok" as never);
    vi.spyOn(PgSyncMark, "markDirty").mockResolvedValue(undefined);
    vi.spyOn(PgSyncMark, "projectIds").mockResolvedValue([]);
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  afterEach(() => {
    effect?.dispose();
    vi.restoreAllMocks();
  });

  it("reconciles it, so the project is pulled and not just its conversation", async () => {
    // Opening a project is the moment its files matter, and this effect was
    // subscribed to file changes alone -- so a project only ever reached the
    // server by being typed in, and one another device had moved on kept
    // showing its stale local copy until a reload or a tab refocus. The
    // conversation was the only half being pulled here.
    //
    // A reconcile rather than a push, because which direction the project
    // needs to move is exactly the question, and only the marks can answer it.
    const order: string[] = [];
    vi.spyOn(PgProjectSync, "holdPushes").mockImplementation(() =>
      order.push("hold")
    );
    vi.spyOn(PgProjectSync, "releasePushes").mockImplementation(() =>
      order.push("release")
    );
    vi.spyOn(restore, "reconcile").mockImplementation(async () => {
      order.push("reconcile");
      return {
        imported: [],
        replaced: [],
        removed: [],
        pushed: [],
        conflicts: [],
        latest: null,
      };
    });

    effect = projectSync();
    dispatch(PgExplorer.events.ON_DID_SWITCH_WORKSPACE);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(order).toEqual(["hold", "reconcile", "release"]);
  });

  it("does not re-enter when the reconcile itself re-opens the workspace", async () => {
    // Taking another device's copy re-opens the workspace whose files it just
    // replaced, and re-opening dispatches a switch. Unguarded, that switch
    // starts another reconcile, which adopts, which re-opens -- the two bounce
    // off each other for as long as the tab is open, and the project is
    // uploaded dozens of times a second.
    let reconciles = 0;
    vi.spyOn(PgProjectSync, "holdPushes").mockImplementation(() => {});
    vi.spyOn(PgProjectSync, "releasePushes").mockImplementation(() => {});
    vi.spyOn(restore, "reconcile").mockImplementation(async () => {
      reconciles++;
      // What `adopt` does to the current workspace
      dispatch(PgExplorer.events.ON_DID_SWITCH_WORKSPACE);
      return {
        imported: [],
        replaced: ["alpha"],
        removed: [],
        pushed: [],
        conflicts: [],
        latest: "alpha",
      };
    });

    effect = projectSync();
    dispatch(PgExplorer.events.ON_DID_SWITCH_WORKSPACE);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reconciles).toBe(1);
  });
});

describe("deleting a workspace here", () => {
  let effect: Disposable | null;

  beforeEach(() => {
    effect = null;
    vi.spyOn(PgProjectSync, "pushCurrent").mockResolvedValue("ok" as never);
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  afterEach(() => {
    effect?.dispose();
    vi.restoreAllMocks();
    stored().delete(PgWorkspace.WORKSPACES_CONFIG_PATH);
  });

  const stored = () =>
    (PgFs as unknown as { __files: Map<string, string> }).__files;

  /** The list as the store holds it, which may be ahead of this tab's */
  const registered = (workspaces: Array<{ id: string; name: string }>) =>
    stored().set(
      PgWorkspace.WORKSPACES_CONFIG_PATH,
      JSON.stringify({ workspaces })
    );

  it("tombstones it on the server and drops its conversation", async () => {
    // `onDidDeleteWorkspace` carries no id, so the deleted project is found by
    // elimination: a mark whose id no longer resolves to a workspace
    vi.spyOn(PgSyncMark, "projectIds").mockResolvedValue([
      "tut:hello",
      "still-here",
    ]);
    vi.spyOn(PgSyncMark, "remove").mockResolvedValue(undefined);
    vi.spyOn(PgExplorer, "workspaceNameOf").mockImplementation((id: string) =>
      id === "still-here" ? "Still Here" : undefined
    );
    const remove = vi
      .spyOn(PgProjectSync, "remove")
      .mockResolvedValue(true as never);
    const forget = vi.spyOn(PgThreadIndex, "forget").mockResolvedValue(true);

    registered([{ id: "still-here", name: "Still Here" }]);

    effect = projectSync();
    dispatch(PgExplorer.events.ON_DID_DELETE_WORKSPACE);
    // A macrotask, not a handful of microtasks: the subscriber awaits the
    // mark listing and then three calls per orphaned project
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(remove).toHaveBeenCalledWith("tut:hello");
    expect(remove).not.toHaveBeenCalledWith("still-here");
    // A tutorial's id is derived from its name, so restarting one reuses the
    // id -- and without this the previous run's conversation comes back with
    // it. Through the index, by workspace id: storage is keyed by thread id,
    // so removing by the project's id removed nothing.
    expect(forget).toHaveBeenCalledWith("tut:hello");
    expect(forget).not.toHaveBeenCalledWith("still-here");
  });

  it("marks the account empty once deleting its last project here leaves none", async () => {
    vi.spyOn(PgSyncMark, "projectIds").mockResolvedValue(["last"]);
    vi.spyOn(PgSyncMark, "remove").mockResolvedValue(undefined);
    vi.spyOn(PgExplorer, "workspaceNameOf").mockReturnValue(undefined);
    vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue([]);
    vi.spyOn(PgProjectSync, "remove").mockResolvedValue(true as never);
    vi.spyOn(PgThreadIndex, "forget").mockResolvedValue(true);
    registered([]);
    PgAccountList.listed(1);

    effect = projectSync();
    dispatch(PgExplorer.events.ON_DID_DELETE_WORKSPACE);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(PgAccountList.state).toBe("empty");
    PgAccountList.forget();
  });

  it("leaves an unread account list unread, whatever is deleted here", async () => {
    vi.spyOn(PgSyncMark, "projectIds").mockResolvedValue(["local-only"]);
    vi.spyOn(PgSyncMark, "remove").mockResolvedValue(undefined);
    vi.spyOn(PgExplorer, "workspaceNameOf").mockReturnValue(undefined);
    vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue([]);
    vi.spyOn(PgProjectSync, "remove").mockResolvedValue(true as never);
    vi.spyOn(PgThreadIndex, "forget").mockResolvedValue(true);
    registered([]);
    PgAccountList.forget();

    effect = projectSync();
    dispatch(PgExplorer.events.ON_DID_DELETE_WORKSPACE);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(PgAccountList.state).toBe("unknown");
  });

  it("keeps the account's list as it was when the delete did not reach it", async () => {
    vi.spyOn(PgSyncMark, "projectIds").mockResolvedValue(["last"]);
    vi.spyOn(PgSyncMark, "remove").mockResolvedValue(undefined);
    vi.spyOn(PgExplorer, "workspaceNameOf").mockReturnValue(undefined);
    vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue([]);
    vi.spyOn(PgProjectSync, "remove").mockResolvedValue(false as never);
    vi.spyOn(PgThreadIndex, "forget").mockResolvedValue(true);
    registered([]);
    PgAccountList.listed(1);

    effect = projectSync();
    dispatch(PgExplorer.events.ON_DID_DELETE_WORKSPACE);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(PgAccountList.state).toBe("holds");
    PgAccountList.forget();
  });

  it("leaves a project another tab created that this tab has not listed", async () => {
    // Synced from the neighbour, so it has a mark, which every tab shares --
    // and no name here until this tab re-reads the list
    vi.spyOn(PgSyncMark, "projectIds").mockResolvedValue([
      "deleted-here",
      "made-next-door",
    ]);
    vi.spyOn(PgSyncMark, "remove").mockResolvedValue(undefined);
    vi.spyOn(PgExplorer, "workspaceNameOf").mockReturnValue(undefined);
    const remove = vi
      .spyOn(PgProjectSync, "remove")
      .mockResolvedValue(true as never);
    const forget = vi.spyOn(PgThreadIndex, "forget").mockResolvedValue(true);
    registered([{ id: "made-next-door", name: "Next Door" }]);

    effect = projectSync();
    dispatch(PgExplorer.events.ON_DID_DELETE_WORKSPACE);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(remove).toHaveBeenCalledWith("deleted-here");
    expect(remove).not.toHaveBeenCalledWith("made-next-door");
    expect(forget).not.toHaveBeenCalledWith("made-next-door");
  });

  it("drops the claim of a workspace deleted before its first upload", async () => {
    // Claimed and never uploaded, so it has no mark for the loop over marks
    // to find; left behind, the claim would vouch for another account's
    // project that later turns up under the same id
    vi.spyOn(PgSyncMark, "projectIds").mockResolvedValue([]);
    vi.spyOn(PgSyncClaim, "projectIds").mockResolvedValue([
      "tut:gone",
      "tut:here",
      "made-next-door",
    ]);
    vi.spyOn(PgExplorer, "workspaceNameOf").mockImplementation((id: string) =>
      id === "tut:here" ? "Here" : undefined
    );
    const forget = vi.spyOn(PgSyncClaim, "forget").mockResolvedValue(undefined);
    registered([
      { id: "tut:here", name: "Here" },
      { id: "made-next-door", name: "Next Door" },
    ]);

    effect = projectSync();
    dispatch(PgExplorer.events.ON_DID_DELETE_WORKSPACE);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(forget.mock.calls).toEqual([["tut:gone"]]);
  });

  it("deletes nothing when the store cannot say what it lists", async () => {
    vi.spyOn(PgSyncMark, "projectIds").mockResolvedValue(["unknown"]);
    vi.spyOn(PgExplorer, "workspaceNameOf").mockReturnValue(undefined);
    const remove = vi
      .spyOn(PgProjectSync, "remove")
      .mockResolvedValue(true as never);
    stored().set(PgWorkspace.WORKSPACES_CONFIG_PATH, '{"workspaces":[');

    effect = projectSync();
    dispatch(PgExplorer.events.ON_DID_DELETE_WORKSPACE);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(remove).not.toHaveBeenCalled();
  });
});
