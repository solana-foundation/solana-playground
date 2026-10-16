import type { MockInstance } from "vitest";
import { chatThread } from "./chat-thread";
import { openThread } from "./open-thread";
import { pushThread } from "./push-thread";
import { PgChatSync } from "../../features/persistence/model/chat-sync";
import { PgThreadIndex } from "../../features/persistence/model/thread-index";
import { PgAssistant } from "../../views/sidebar/assistant/store";
import { PgExplorer } from "../../utils/explorer/explorer";
import type { Disposable } from "../../utils/types";

/**
 * Conversations have none of the machinery that keeps project code safe.
 *
 * There is no dirty flag, no debounce and no reconcile: the only push outside
 * the sign-in and sign-out dumps is at the end of a turn, fire-and-forget,
 * with the result discarded. So the tab going away is the last chance to get
 * a turn to the account, and nothing was taking it.
 */

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

/** Let the effect's own `open()` settle before asserting on anything else */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the chat-thread effect", () => {
  let push: MockInstance;
  let effect: Disposable | null;

  beforeEach(() => {
    effect = null;
    push = vi.spyOn(PgChatSync, "push").mockResolvedValue("pushed");
    vi.spyOn(PgChatSync, "fetchThread").mockResolvedValue(null);
    vi.spyOn(PgChatSync, "adoptAccountThread").mockResolvedValue(null);
    vi.spyOn(PgAssistant, "loadThread").mockResolvedValue(undefined);
    vi.spyOn(PgAssistant, "threadId", "get").mockReturnValue("p1");
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue(
      "p1" as never
    );
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  afterEach(() => {
    effect?.dispose();
    vi.restoreAllMocks();
  });

  it("hands the open thread over as the tab goes to the background", async () => {
    effect = chatThread();
    await settle();
    push.mockClear();

    // Any change to the thread; `clear` emits without writing back
    PgAssistant.clear();
    setVisibility("hidden");
    await settle();

    expect(push).toHaveBeenCalledWith("p1");
  });

  it("waits for the last write to land before pushing", async () => {
    // `push` reads the thread from storage, and the store's writes are fired
    // and forgotten: pushing straight away could upload the copy from one
    // write earlier, missing the last thing that happened
    let landed: () => void = () => {};
    vi.spyOn(PgAssistant, "whenPersisted").mockReturnValue(
      new Promise<void>((resolve) => (landed = resolve))
    );
    effect = chatThread();
    await settle();
    push.mockClear();

    PgAssistant.clear();
    setVisibility("hidden");
    await settle();
    expect(push).not.toHaveBeenCalled();

    landed();
    await settle();
    expect(push).toHaveBeenCalledWith("p1");
  });

  it("does not push when nothing has happened since the last one", async () => {
    // The whole thread goes up each time and the server writes nothing for
    // a copy it already has, so this is about not making a request per
    // tab-switch for every user rather than about correctness
    effect = chatThread();
    await settle();
    push.mockClear();

    setVisibility("hidden");
    await settle();

    expect(push).not.toHaveBeenCalled();
  });

  it("tries again on the next hide when the push failed", async () => {
    // The only retry conversations have
    push.mockResolvedValue("failed");
    effect = chatThread();
    await settle();

    // Any change to the thread; `clear` emits without writing back
    PgAssistant.clear();
    setVisibility("hidden");
    await settle();
    push.mockClear();

    setVisibility("visible");
    setVisibility("hidden");
    await settle();

    expect(push).toHaveBeenCalledWith("p1");
  });

  describe("while a turn is running", () => {
    // The reply is still streaming into its item, so the thread on disk holds
    // a half-written answer. Pushing it put that fragment on the server, and
    // the other device pulled it.
    let status: MockInstance;

    beforeEach(() => {
      status = vi.spyOn(PgAssistant, "status", "get");
    });

    it("does not push as the tab goes to the background", async () => {
      effect = chatThread();
      await settle();
      push.mockClear();

      status.mockReturnValue("running");
      PgAssistant.clear();
      setVisibility("hidden");
      await settle();

      expect(push).not.toHaveBeenCalled();
    });

    it("does not push as the page goes away", async () => {
      effect = chatThread();
      await settle();
      push.mockClear();

      status.mockReturnValue("running");
      PgAssistant.clear();
      window.dispatchEvent(new Event("pagehide"));
      await settle();

      expect(push).not.toHaveBeenCalled();
    });

    it("does not push while the turn waits on an approval either", async () => {
      // Still the same turn: the reply resumes once the user answers
      effect = chatThread();
      await settle();
      push.mockClear();

      status.mockReturnValue("awaiting");
      PgAssistant.clear();
      setVisibility("hidden");
      await settle();

      expect(push).not.toHaveBeenCalled();
    });

    it("pushes on the next hide once the turn has finished", async () => {
      // The skipped flush must leave the thread owed, or the finished reply
      // would only reach the account through the end-of-turn push
      effect = chatThread();
      await settle();
      push.mockClear();

      status.mockReturnValue("running");
      PgAssistant.clear();
      setVisibility("hidden");
      setVisibility("visible");
      await settle();
      push.mockClear();

      status.mockReturnValue("idle");
      setVisibility("hidden");
      await settle();

      expect(push).toHaveBeenCalledWith("p1");
    });
  });

  it("stops listening once disposed", async () => {
    const disposable = chatThread();
    await settle();
    // Any change to the thread; `clear` emits without writing back
    PgAssistant.clear();
    disposable.dispose();
    push.mockClear();

    setVisibility("hidden");
    await settle();

    expect(push).not.toHaveBeenCalled();
  });

  it("pushes the outgoing thread on a workspace switch, even mid-turn", async () => {
    // A switch closes the thread, so nothing more will be written to it: what
    // is stored is as finished as it gets, and it has to go before the new
    // thread replaces it as the open one
    let switched: () => void = () => {};
    vi.spyOn(PgExplorer, "onDidSwitchWorkspace").mockImplementation((cb) => {
      switched = cb as () => void;
      return { dispose: () => {} };
    });
    vi.spyOn(PgAssistant, "status", "get").mockReturnValue("running");
    const order: string[] = [];
    push.mockImplementation(async (id: string) => {
      order.push(`push ${id}`);
      return true;
    });
    effect = chatThread();
    await settle();
    order.length = 0;
    const close = vi
      .spyOn(PgAssistant, "closeThread")
      .mockImplementation(() => order.push("close"));

    PgAssistant.clear();
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue(
      "p2" as never
    );
    switched();
    await settle();

    expect(close).toHaveBeenCalled();
    // `flush` captured the outgoing id before `open` closed it
    expect(order).toEqual(["close", "push p1"]);
  });

  it("moves to the account's thread when the server has never seen this one", async () => {
    // Sign-out clears the thread index, so the next open mints a fresh id and
    // its pull 404s -- while the account holds the conversation under another
    vi.spyOn(PgChatSync, "fetchThread").mockImplementation(async (id) =>
      id === "p1" ? "missing" : null
    );
    vi.spyOn(PgChatSync, "adoptAccountThread").mockResolvedValue(
      "account-thread"
    );
    const load = PgAssistant.loadThread as unknown as MockInstance;

    await openThread("p1", "p1");

    expect(PgChatSync.adoptAccountThread).toHaveBeenCalledWith("p1");
    expect(load).toHaveBeenLastCalledWith("account-thread");
    expect(PgChatSync.fetchThread).toHaveBeenLastCalledWith("account-thread");
  });

  it("does not go looking for the account's thread when the request failed", async () => {
    // Adopting reloads the panel, and the session effect opens a thread that
    // may be mid-turn: a reload then denies the card the user has not
    // answered. Only a thread the server says it lacks is worth that.
    vi.spyOn(PgChatSync, "fetchThread").mockResolvedValue(null);

    await openThread("p1", "p1");

    expect(PgChatSync.adoptAccountThread).not.toHaveBeenCalled();
  });

  it("does not look elsewhere when the pull found the thread", async () => {
    vi.spyOn(PgChatSync, "fetchThread").mockResolvedValue([]);
    vi.spyOn(PgAssistant, "foldIn").mockResolvedValue(true);

    await openThread("p1", "p1");

    expect(PgChatSync.adoptAccountThread).not.toHaveBeenCalled();
  });

  it("folds the server's copy into the open thread instead of reloading it", async () => {
    // A forced reload denied a pending approval, reset the status mid-turn
    // and replaced memory with a stored copy that can lag it
    const served = [
      {
        kind: "user" as const,
        id: "77777777-7777-4777-8777-777777777777",
        createdAt: "2026-01-01T00:00:00.000Z",
        text: "from the server",
      },
    ];
    vi.spyOn(PgChatSync, "fetchThread").mockResolvedValue(served);
    const fold = vi.spyOn(PgAssistant, "foldIn").mockResolvedValue(true);
    const stored = vi.spyOn(PgChatSync, "storeMerged");
    const load = PgAssistant.loadThread as unknown as MockInstance;

    await openThread("p1", "p1");

    expect(fold).toHaveBeenCalledWith("p1", served);
    expect(stored).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalledWith("p1", true);
  });

  describe("when the user switched away mid-request", () => {
    // Nothing in memory to fold into, and storage is then the only copy
    let fold: MockInstance;
    let stored: MockInstance;
    /** Lands the store's last write to the thread just left */
    let landed: () => void;

    beforeEach(() => {
      vi.spyOn(PgChatSync, "fetchThread").mockResolvedValue([]);
      fold = vi.spyOn(PgAssistant, "foldIn").mockResolvedValue(false);
      stored = vi.spyOn(PgChatSync, "storeMerged").mockResolvedValue([]);
      vi.spyOn(PgAssistant, "whenPersisted").mockReturnValue(
        new Promise<void>((resolve) => (landed = resolve))
      );
    });

    it("stores the server's copy once the last write has landed", async () => {
      // Merging first read the file without the message still queued, and
      // wrote it back the same way
      const opened = openThread("p1", "p1");
      await settle();
      expect(stored).not.toHaveBeenCalled();

      landed();
      await opened;

      expect(stored).toHaveBeenCalledWith("p1", []);
    });

    it("folds it in instead when the user came back during the wait", async () => {
      // Stored then, the merge lands under a panel that has already read the
      // file without it, and its next write puts the old copy back
      const opened = openThread("p1", "p1");
      await settle();
      fold.mockResolvedValue(true);

      landed();
      await opened;

      expect(stored).not.toHaveBeenCalled();
    });

    it("folds it in after storing, in case the user came back meanwhile", async () => {
      landed();
      await openThread("p1", "p1");

      expect(stored).toHaveBeenCalled();
      expect(fold).toHaveBeenCalledTimes(3);
      expect(fold.mock.invocationCallOrder[2]).toBeGreaterThan(
        stored.mock.invocationCallOrder[0]
      );
    });
  });
});

describe("pushThread", () => {
  afterEach(() => vi.restoreAllMocks());

  it("waits for the store's last write before pushing", async () => {
    // `push` reads storage, and the write the final streamed delta queued
    // may still be in flight: pushing first uploaded the reply short of it
    let landed: () => void = () => {};
    vi.spyOn(PgAssistant, "whenPersisted").mockReturnValue(
      new Promise<void>((resolve) => (landed = resolve))
    );
    const push = vi.spyOn(PgChatSync, "push").mockResolvedValue("pushed");

    const pushed = pushThread("t1");
    await settle();
    expect(push).not.toHaveBeenCalled();

    landed();
    await expect(pushed).resolves.toBe(true);
    expect(push).toHaveBeenCalledWith("t1");
  });

  describe("a thread the server has deleted", () => {
    beforeEach(() => {
      vi.spyOn(PgChatSync, "fetchThread").mockResolvedValue(null);
      vi.spyOn(PgChatSync, "adoptAccountThread").mockResolvedValue(null);
      vi.spyOn(PgAssistant, "loadThread").mockResolvedValue(undefined);
      vi.spyOn(PgThreadIndex, "workspaceOf").mockResolvedValue("p1");
      vi.spyOn(PgThreadIndex, "forget").mockResolvedValue(true);
      vi.spyOn(PgThreadIndex, "ensure").mockResolvedValue("t2");
      vi.spyOn(PgAssistant, "closeThread").mockImplementation(() => {});
      vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue(
        "p1" as never
      );
    });

    it("is forgotten and replaced when its project is still live", async () => {
      // A tutorial started again on another device: the project row is
      // live, the previous run's thread is not. It used to be pushed and
      // refused again on every turn, for ever.
      vi.spyOn(PgChatSync, "push").mockResolvedValue("thread-deleted");
      vi.spyOn(PgAssistant, "threadId", "get").mockReturnValue("t1");

      await expect(pushThread("t1")).resolves.toBe(true);

      expect(PgThreadIndex.forget).toHaveBeenCalledWith("p1");
      // The fresh thread is opened the ordinary way, so it adopts the
      // account's conversation for the restarted run if there is one
      expect(PgAssistant.loadThread).toHaveBeenCalledWith("t2");
      expect(PgChatSync.fetchThread).toHaveBeenCalledWith("t2");
    });

    it("moves the panel off it before its file goes", async () => {
      // A message sent while `forget` waited on the lock was written into
      // the file it then deleted, and vanished with the reply after it
      vi.spyOn(PgChatSync, "push").mockResolvedValue("thread-deleted");
      vi.spyOn(PgAssistant, "threadId", "get").mockReturnValue("t1");
      const persisted = vi.spyOn(PgAssistant, "whenPersisted");

      await pushThread("t1");

      const [forgotten] = vi.mocked(PgThreadIndex.forget).mock
        .invocationCallOrder;
      const [closed] = vi.mocked(PgAssistant.closeThread).mock
        .invocationCallOrder;
      expect(closed).toBeLessThan(forgotten);
      // The store's write chain is waited on again after the close: the
      // first wait was before the push
      expect(persisted.mock.invocationCallOrder[1]).toBeLessThan(forgotten);
    });

    it("stays owed when it could not be forgotten", async () => {
      vi.spyOn(PgChatSync, "push").mockResolvedValue("thread-deleted");
      vi.spyOn(PgAssistant, "threadId", "get").mockReturnValue("t1");
      vi.mocked(PgThreadIndex.forget).mockResolvedValue(false);

      await expect(pushThread("t1")).resolves.toBe(false);
    });

    it("is forgotten but not reopened when another workspace is open", async () => {
      // The panel still names the thread, but the user has switched
      // workspace and the switch has not reached it yet
      vi.spyOn(PgChatSync, "push").mockResolvedValue("thread-deleted");
      vi.spyOn(PgAssistant, "threadId", "get").mockReturnValue("t1");
      vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue(
        "p2" as never
      );

      await pushThread("t1");

      expect(PgThreadIndex.forget).toHaveBeenCalledWith("p1");
      expect(PgAssistant.closeThread).not.toHaveBeenCalled();
      expect(PgAssistant.loadThread).not.toHaveBeenCalled();
    });

    it("is forgotten but not reopened when the panel has moved on", async () => {
      vi.spyOn(PgChatSync, "push").mockResolvedValue("thread-deleted");
      vi.spyOn(PgAssistant, "threadId", "get").mockReturnValue("t9");

      await pushThread("t1");

      expect(PgThreadIndex.forget).toHaveBeenCalledWith("p1");
      expect(PgAssistant.loadThread).not.toHaveBeenCalled();
    });

    it("is left alone when the project itself was deleted", async () => {
      // The user is about to be asked about the project, and the answer
      // settles the chat too: "keep as new" carries it, "delete" drops it.
      // Forgetting it here lost the conversation before the question was
      // on screen.
      vi.spyOn(PgChatSync, "push").mockResolvedValue("project-deleted");
      vi.spyOn(PgAssistant, "threadId", "get").mockReturnValue("t1");

      // Owed, not settled: a tutorial restarted on this device revives the
      // project with its own push, and the thread has to follow it
      await expect(pushThread("t1")).resolves.toBe(false);

      expect(PgThreadIndex.forget).not.toHaveBeenCalled();
      expect(PgAssistant.loadThread).not.toHaveBeenCalled();
    });
  });
});
