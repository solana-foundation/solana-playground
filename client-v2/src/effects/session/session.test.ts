import type { MockInstance } from "vitest";
import { session } from "./session";
import { PgSession } from "../../features/auth";
import { PgAccountList } from "../../features/persistence/model/account-list";
import { PgChatStorage } from "../../features/persistence/model/chat-storage";
import { PgChatSync } from "../../features/persistence/model/chat-sync";
import { PgProjectSync } from "../../features/persistence/model/project-sync";
import * as restore from "../../features/persistence/model/project-restore";
import { PgSyncClient } from "../../features/persistence/model/sync-client";
import { PgThreadIndex } from "../../features/persistence/model/thread-index";
import { PgAssistant } from "../../views/sidebar/assistant/store";
import { PgExplorer } from "../../utils/explorer/explorer";
import { PgFs } from "../../utils/explorer/fs";
import type { SyncResult } from "../../features/persistence/model/project-restore";
import type { ChatItem } from "../../views/sidebar/assistant/store";

/**
 * The order these run in is the whole of the behaviour.
 *
 * Reconciling before pushing is what stops a device that has not caught up
 * announcing itself with a write the server refuses; waiting for the explorer
 * is what stops the whole pass failing into a diagnostics line; and closing the
 * thread after the hand-over is what stops the previous user's transcript being
 * uploaded into the next account.
 */

const user = { id: "u1", name: null, image: null, login: null };

const settle = () => new Promise((r) => setTimeout(r, 0));

const result = (over: Partial<SyncResult> = {}): SyncResult => ({
  imported: [],
  replaced: [],
  removed: [],
  pushed: [],
  conflicts: [],
  latest: null,
  ...over,
});

describe("the session effect", () => {
  let calls: string[];
  let sync: MockInstance;
  let switchWorkspace: MockInstance;

  beforeEach(() => {
    calls = [];
    PgSession.reset();

    vi.spyOn(PgChatSync, "adoptAccountThreads").mockImplementation(async () => {
      calls.push("adoptChats");
    });
    vi.spyOn(PgChatSync, "pushAll").mockImplementation(async () => {
      calls.push("pushChats");
      return { handedOver: [], complete: true };
    });
    sync = vi.spyOn(restore, "reconcile").mockImplementation(async () => {
      calls.push("reconcile");
      return result();
    });
    vi.spyOn(PgProjectSync, "holdPushes").mockImplementation(() =>
      calls.push("hold")
    );
    vi.spyOn(PgProjectSync, "releasePushes").mockImplementation(() =>
      calls.push("release")
    );
    switchWorkspace = vi
      .spyOn(PgExplorer, "switchWorkspace")
      .mockResolvedValue(undefined as never);
    vi.spyOn(PgExplorer, "allWorkspaceNames", "get").mockReturnValue([
      "Hello Anchor",
      "Newest",
    ]);
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue(
      "Hello Anchor"
    );
    vi.spyOn(PgExplorer, "isInitialized", "get").mockReturnValue(true);
    vi.spyOn(PgSession, "refresh").mockImplementation(async () => {
      await PgSession.refreshWith(user);
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("reconciles the account before anything else touches it", async () => {
    const effect = session();
    await settle();

    expect(calls.filter((c) => c !== "hold" && c !== "release")).toEqual([
      // Adopt first: the dump would otherwise upload a thread minted while
      // signed out as a second conversation, and the account's would be lost
      "adoptChats",
      "pushChats",
      "reconcile",
    ]);
    effect.dispose();
  });

  it("takes on the account when Home read the session before the effects mounted", async () => {
    // Effects mount after a delay, and Home starts the page's read as it
    // draws: the user is known before this effect exists, so no change fires
    await PgSession.refreshWith(user);
    calls = [];

    const effect = session();
    await settle();

    expect(calls).toContain("reconcile");
    expect(switchWorkspace).not.toHaveBeenCalled();
    // The effect's own hold, given back once by the restore
    expect(calls.filter((c) => c === "hold")).toHaveLength(1);
    expect(calls.filter((c) => c === "release")).toHaveLength(1);
    effect.dispose();
  });

  it("takes a sign-in after a signed-out read Home made before the effects mounted as a sign-in", async () => {
    sync.mockResolvedValue(result({ latest: "Newest" }));
    await PgSession.refreshWith(null);
    (PgSession.refresh as unknown as MockInstance).mockResolvedValue(undefined);

    const effect = session();
    await settle();
    expect(calls).not.toContain("reconcile");
    await PgSession.refreshWith(user);
    await settle();

    expect(switchWorkspace).toHaveBeenCalledWith("Newest");
    effect.dispose();
  });

  it("waits for the explorer before reconciling against it", async () => {
    // Effects mount concurrently with the async `PgExplorer.init()`. Running
    // first meant `workspaceNameOf` answered `undefined` for everything and
    // `importWorkspace` threw `NOT_FOUND`, which the per-project catch turned
    // into a diagnostics line -- the whole account sync failing invisibly.
    vi.spyOn(PgExplorer, "isInitialized", "get").mockReturnValue(false);
    let fireInit: () => unknown = () => {};
    vi.spyOn(PgExplorer, "onDidInit").mockImplementation((cb) => {
      fireInit = cb;
      return { dispose: () => {} };
    });

    const effect = session();
    await settle();
    expect(calls).not.toContain("reconcile");

    fireInit();
    await settle();
    expect(calls).toContain("reconcile");
    effect.dispose();
  });

  it("does not move the user off the page they loaded", async () => {
    sync.mockResolvedValue(result({ latest: "Newest" }));

    const effect = session();
    await settle();

    expect(switchWorkspace).not.toHaveBeenCalled();
    effect.dispose();
  });

  it("pulls the open thread once the session is back, even when it is unchanged", async () => {
    // On load the chat effect opens the thread before the cookie is restored,
    // so its pull stands down with no request at all. The thread id does not
    // change at sign-in -- the account already has it -- so nothing else
    // pulls, and the panel shows only what this browser had stored.
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue("w1");
    vi.spyOn(PgAssistant, "threadId", "get").mockReturnValue("t1");
    vi.spyOn(PgThreadIndex, "get").mockResolvedValue("t1");
    vi.spyOn(PgAssistant, "loadThread").mockResolvedValue(undefined);
    vi.spyOn(PgAssistant, "foldIn").mockResolvedValue(true);
    const pull = vi.spyOn(PgChatSync, "fetchThread").mockResolvedValue([]);

    const effect = session();
    await settle();

    expect(pull).toHaveBeenCalledWith("t1");
    effect.dispose();
  });

  it("does not repaint a thread for a workspace the user has left", async () => {
    // The index read is a storage round trip; a switch landing inside it
    // must not have the old workspace's thread opened over the new one
    const current = vi
      .spyOn(PgExplorer, "currentWorkspaceId", "get")
      .mockReturnValue("w1");
    vi.spyOn(PgAssistant, "threadId", "get").mockReturnValue("t1");
    vi.spyOn(PgThreadIndex, "get").mockImplementation(async () => {
      current.mockReturnValue("w2");
      return "t1";
    });
    const load = vi
      .spyOn(PgAssistant, "loadThread")
      .mockResolvedValue(undefined);
    vi.spyOn(PgChatSync, "fetchThread").mockResolvedValue([]);

    const effect = session();
    await settle();

    expect(load).not.toHaveBeenCalled();
    effect.dispose();
  });

  /**
   * The restore lands several round trips after load -- the explorer, the
   * chat dump, the reconcile, which can stop for a conflict prompt -- so a
   * turn being under way by then is ordinary. Re-opening the thread used to
   * force-reload it from storage, which denied the card the user had not
   * answered yet, dropped the status to idle mid-turn, and replaced memory
   * with a copy on disk that can lag it.
   */
  describe("landing while a turn is running", () => {
    const fromServer: ChatItem = {
      kind: "assistant",
      id: "55555555-5555-4555-8555-555555555555",
      createdAt: "2026-01-01T00:00:00.000Z",
      text: "from the other device",
    };

    /** Settles the server's answer to the thread read */
    let answer: (items: ChatItem[]) => void;
    let fetchMock: MockInstance;

    const texts = () =>
      PgAssistant.items.map((i) => ("text" in i ? i.text : i.kind));

    /** Ticks until `ready` holds, or gives up and lets the asserts say why */
    const until = async (ready: () => boolean) => {
      for (let i = 0; i < 100 && !ready(); i++) await settle();
    };

    const threadRequested = () =>
      fetchMock.mock.calls.some(([url]) => String(url).includes("threadId="));

    beforeEach(async () => {
      (PgFs as unknown as { __files: Map<string, string> }).__files.clear();
      PgAssistant.closeThread();
      PgAssistant.clear();
      PgSyncClient.reset();
      await PgAssistant.loadThread("t1");

      vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue("w1");
      vi.spyOn(PgThreadIndex, "get").mockResolvedValue("t1");
      const served = new Promise<ChatItem[]>((resolve) => (answer = resolve));
      const respond = async (url: string) => {
        if (url === "/api/sync") {
          return { ok: true, json: async () => ({ enabled: true, db: "ok" }) };
        }
        const items = await served;
        return { ok: true, json: async () => ({ items }) };
      };
      fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(respond as never);
    });

    afterEach(() => PgAssistant.closeThread());

    it("leaves an unanswered approval waiting on the user", async () => {
      PgAssistant.addUserMessage("build it");
      const approval = PgAssistant.requestApproval({
        type: "command",
        name: "build",
        effect: "builds",
      });

      const effect = session();
      await until(threadRequested);
      answer([fromServer]);
      await until(() => texts().includes("from the other device"));

      expect(texts()).toContain("from the other device");
      expect(PgAssistant.status).toBe("awaiting");
      const card = PgAssistant.items.find((i) => i.kind === "approval");
      expect(card).toMatchObject({ status: "pending" });

      // And it still answers: the promise holding the turn open is intact
      PgAssistant.resolveApproval(card!.id, true);
      await expect(approval).resolves.toMatchObject({ allowed: true });
      effect.dispose();
    });

    it("keeps the status and what streamed in while the pull was out", async () => {
      PgAssistant.addUserMessage("explain it");
      PgAssistant.setStatus("running");
      const reply = PgAssistant.startAssistantMessage();

      const effect = session();
      await until(threadRequested);
      PgAssistant.appendToAssistantMessage(reply, "It logs");
      PgAssistant.addNotice("added during the pull");
      answer([fromServer]);
      await until(() => texts().includes("from the other device"));

      expect(PgAssistant.status).toBe("running");
      expect(texts()).toEqual(
        expect.arrayContaining([
          "explain it",
          "It logs",
          "added during the pull",
          "from the other device",
        ])
      );

      // Streaming carries on into the same item
      PgAssistant.appendToAssistantMessage(reply, " a message");
      expect(texts()).toContain("It logs a message");

      // And storage ends up holding all of it, not a copy from mid-pull
      await PgAssistant.whenPersisted();
      const stored = (await PgChatStorage.read("t1"))!.map((i) =>
        "text" in i ? i.text : i.kind
      );
      expect(stored).toEqual(
        expect.arrayContaining([
          "It logs a message",
          "added during the pull",
          "from the other device",
        ])
      );
      effect.dispose();
    });
  });

  it("takes a retry that answers after a failed first read as the restore, not a sign-in", async () => {
    sync.mockResolvedValue(result({ latest: "Newest" }));
    (PgSession.refresh as unknown as MockInstance).mockRestore();
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user }),
      } as never);

    const effect = session();
    await settle();
    expect(PgSession.readState).toBe("failed");
    // Home's retry of the account check
    await PgSession.refresh();
    await settle();

    expect(PgSession.get()?.id).toBe("u1");
    expect(switchWorkspace).not.toHaveBeenCalled();
    effect.dispose();
  });

  it("opens the newest project for a sign-in that follows a failed load read", async () => {
    sync.mockResolvedValue(result({ latest: "Newest" }));
    (PgSession.refresh as unknown as MockInstance).mockRestore();
    let loadRead = true;
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
      if (url === "/api/auth/get-session") {
        if (loadRead) {
          loadRead = false;
          throw new Error("offline");
        }
        return { ok: true, json: async () => ({ user }) };
      }
      return {
        ok: true,
        json: async () => ({ url: "https://github.com/login/oauth/x" }),
      };
    }) as never);
    PgSession.setOpenChannel(() => ({
      receive: async () => ({ delivered: true as const, data: {} }),
      cancel: () => {},
    }));

    const effect = session();
    await settle();
    expect(PgSession.readState).toBe("failed");
    await PgSession.signIn();
    await settle();

    expect(switchWorkspace).toHaveBeenCalledWith("Newest");
    effect.dispose();
  });

  it("holds pushes again for a restore that answers after a failed load read", async () => {
    (PgSession.refresh as unknown as MockInstance).mockRestore();
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user }),
      } as never);

    const effect = session();
    await settle();
    expect(calls.filter((c) => c === "release")).toHaveLength(1);

    await PgSession.refresh();
    await settle();

    // Held before the late reconcile, released once after it
    expect(calls.indexOf("hold", 1)).toBeLessThan(
      calls.lastIndexOf("reconcile")
    );
    expect(calls.filter((c) => c === "hold")).toHaveLength(2);
    expect(calls.filter((c) => c === "release")).toHaveLength(2);
    effect.dispose();
  });

  it("forgets what the last account's list held once the user changes, however the session ended", async () => {
    const effect = session();
    await settle();
    PgAccountList.listed(0);

    // A re-read that finds nobody, not a sign-out through the app
    await PgSession.refreshWith(null);

    expect(PgAccountList.state).toBe("unknown");
    effect.dispose();
  });

  it("opens the newest project when the user actually signs in", async () => {
    sync.mockResolvedValue(result({ latest: "Newest" }));

    const effect = session();
    await settle();
    // A second transition: the cookie has already been restored, so this is
    // the user coming back through the sign-in flow
    await PgSession.refreshWith(null);
    await PgSession.refreshWith(user);
    await settle();

    expect(switchWorkspace).toHaveBeenCalledWith("Newest");
    effect.dispose();
  });

  describe("signing in through the popup", () => {
    /** Loads signed in, signs out, and forgets what the load switched to */
    const signedOutAfterLoad = async () => {
      const effect = session();
      await settle();
      await PgSession.refreshWith(null);
      switchWorkspace.mockClear();
      return effect;
    };

    beforeEach(() => {
      sync.mockResolvedValue(result({ latest: "Newest" }));
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ url: "https://github.com/login/oauth/x" }),
      } as never);
      PgSession.setOpenChannel(() => ({
        receive: async () => ({ delivered: true as const, data: {} }),
        cancel: () => {},
      }));
    });

    it("keeps the open project when the sign-in started in the assistant panel", async () => {
      const effect = await signedOutAfterLoad();

      await PgSession.signIn({ from: "assistant" });
      await settle();

      // The composer still holds a prompt written for this project
      expect(switchWorkspace).not.toHaveBeenCalledWith("Newest");
      effect.dispose();
    });

    it("opens the newest project when the sign-in started from the header", async () => {
      const effect = await signedOutAfterLoad();

      await PgSession.signIn();
      await settle();

      expect(switchWorkspace).toHaveBeenCalledWith("Newest");
      effect.dispose();
    });

    it("opens the newest project from the panel when no project is open", async () => {
      vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue(
        undefined
      );
      const effect = await signedOutAfterLoad();

      await PgSession.signIn({ from: "assistant" });
      await settle();

      // Nothing to keep, so a panel sign-in must not skip the switch outright
      expect(switchWorkspace).toHaveBeenCalledWith("Newest");
      effect.dispose();
    });
  });

  it("reopens the current project when the server replaced its files", async () => {
    sync.mockResolvedValue(
      result({ replaced: ["Hello Anchor"], latest: "Hello Anchor" })
    );

    const effect = session();
    await settle();

    // Not a navigation -- the editor is showing files that are no longer what
    // is on disk, and this is what makes it re-read them
    expect(switchWorkspace).toHaveBeenCalledWith("Hello Anchor");
    effect.dispose();
  });

  it("moves the user off a project that was deleted on another device", async () => {
    sync.mockResolvedValue(
      result({ removed: ["Hello Anchor"], latest: "Newest" })
    );

    const effect = session();
    await settle();

    expect(switchWorkspace).toHaveBeenCalledWith("Newest");
    effect.dispose();
  });

  it("holds pushes from load until the account has been read", async () => {
    const effect = session();
    await settle();

    // Held before anything can fire, released the moment the reconcile is
    // done -- a push that gets out first carries no token and comes back
    // refused, which the user was shown as a conflict
    expect(calls.indexOf("hold")).toBe(0);
    expect(calls.indexOf("release")).toBeGreaterThan(
      calls.indexOf("reconcile")
    );
    effect.dispose();
  });

  it("releases them when the chat hand-over fails, not just the reconcile", async () => {
    // Everything on the way to the reconcile is inside the same `try`. This
    // one sat outside it, so a thrown `pushAll` left every project on the
    // device unable to save for the rest of the session -- silently, because
    // the rejection is reported and swallowed.
    vi.spyOn(PgChatSync, "pushAll").mockRejectedValue(
      new Error("indexeddb is having a day")
    );

    const effect = session();
    await settle();

    expect(calls).toContain("release");
    effect.dispose();
  });

  it("releases them even when the reconcile fails", async () => {
    sync.mockRejectedValue(new Error("offline"));

    const effect = session();
    await settle();

    // A reconcile that failed is a reason to let this device save its work,
    // not to hold it forever
    expect(calls).toContain("release");
    effect.dispose();
  });

  it("gives up its hold once, however many ways it gets there", async () => {
    // The gate is counted, so a second release would give up somebody else's
    // hold -- a merge's -- and let the editor upload mid-rewrite. The reconcile
    // finishing, a later sign-in and the effect going away all release.
    const effect = session();
    await settle();
    await PgSession.refreshWith(null);
    await PgSession.refreshWith(user);
    await settle();
    effect.dispose();

    expect(calls.filter((c) => c === "hold")).toHaveLength(1);
    expect(calls.filter((c) => c === "release")).toHaveLength(1);
  });

  it("releases them when nobody is signed in", async () => {
    vi.spyOn(PgSession, "refresh").mockImplementation(async () => {
      await PgSession.refreshWith(null);
    });

    const effect = session();
    await settle();

    expect(calls).toContain("release");
    expect(calls).not.toContain("reconcile");
    effect.dispose();
  });
});

describe("signing out", () => {
  let order: string[];
  const handed = { handedOver: [{ id: "t1", hash: "h1" }], complete: true };

  beforeEach(async () => {
    order = [];
    PgSession.reset();
    vi.spyOn(PgExplorer, "isInitialized", "get").mockReturnValue(true);
    vi.spyOn(PgSession, "refresh").mockResolvedValue(undefined);
    await PgSession.refreshWith(user);
    vi.spyOn(PgChatSync, "pushAll").mockImplementation(async () => {
      order.push("pushChats");
      return handed;
    });
    vi.spyOn(PgProjectSync, "pushCurrent").mockImplementation(async () => {
      order.push("pushProject");
      return "ok";
    });
    vi.spyOn(PgChatSync, "adoptAccountThreads").mockResolvedValue(undefined);
    vi.spyOn(restore, "reconcile").mockResolvedValue(result());
    vi.spyOn(PgChatSync, "forget").mockImplementation(async () => {
      order.push("forgetChats");
    });
    vi.spyOn(restore, "releaseLocalProjects").mockImplementation(async () => {
      order.push("releaseProjects");
      return [];
    });
    vi.spyOn(PgAssistant, "stopTurn").mockImplementation(
      () => order.push("stopTurn") as unknown as void
    );
    vi.spyOn(PgAssistant, "closeThread").mockImplementation(
      () => order.push("closeThread") as unknown as void
    );
    const clear = PgAssistant.clear.bind(PgAssistant);
    vi.spyOn(PgAssistant, "clear").mockImplementation(() => {
      order.push("clear");
      clear();
    });
    vi.spyOn(PgAssistant, "whenPersisted").mockImplementation(async () => {
      order.push("whenPersisted");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    PgProjectSync.forgetAccount();
  });

  // The user is known before the effect mounts, so it takes the account on
  // first; that pass settles before anything here is recorded
  const mount = async () => {
    const effect = session();
    await settle();
    order.length = 0;
    return effect;
  };

  const serverSignsOut = (answer: Partial<Response>) =>
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      order.push("request");
      return answer as Response;
    });

  it("uploads before the request and tears down after it", async () => {
    // Uploads while the request is still authenticated, teardown only once
    // the server has ended the session. The turn stops before the close,
    // which does nothing with no thread open, and `clear` then drops what the
    // panel held unstored. The thread closes first, so the panel stops
    // writing the previous user's transcript back into storage, and again
    // last, because releasing the open project switches workspace and the
    // chat effect opens the next one's thread. A write the panel queued
    // before the close lands ahead of `forget`, which then keeps that thread.
    serverSignsOut({ ok: true });

    const effect = await mount();
    await PgSession.signOut();

    expect(order).toEqual([
      "pushChats",
      "pushProject",
      "request",
      "stopTurn",
      "closeThread",
      "clear",
      "whenPersisted",
      "forgetChats",
      "releaseProjects",
      "closeThread",
    ]);
    effect.dispose();
  });

  it("drops what the panel holds with no workspace open", async () => {
    // Deleting the last project leaves the panel working with no thread; what
    // it holds then was never stored, and the next thread to open -- the next
    // account's -- would adopt it
    serverSignsOut({ ok: true });
    expect(PgAssistant.threadId).toBeNull();
    PgAssistant.addUserMessage("from the last account");

    const effect = await mount();
    await PgSession.signOut();

    expect(PgAssistant.items).toEqual([]);
    effect.dispose();
  });

  it("forgets exactly what the upload handed over", async () => {
    // Anything else and the threads stay: `forget(null)` keeps every one, and
    // the next account's sign-in dump uploads them into that account
    serverSignsOut({ ok: true });

    const effect = await mount();
    await PgSession.signOut();

    expect(PgChatSync.forget).toHaveBeenCalledWith(handed);
    effect.dispose();
  });

  it("tears nothing down when the server refuses the sign-out", async () => {
    // The user is still signed in. Tearing down first left them with their
    // conversation closed and their projects gone from the browser.
    serverSignsOut({ ok: false, status: 500 });
    PgProjectSync.raise({ projectId: "tut:hello", kind: "divergent" });

    const effect = await mount();
    await expect(PgSession.signOut()).rejects.toThrow();

    expect(order).toEqual(["pushChats", "pushProject", "request"]);
    expect(PgSession.get()).toEqual(user);
    expect(PgProjectSync.conflictFor("tut:hello")).not.toBeNull();
    effect.dispose();
  });

  it("keeps every thread when the hand-over fails, and still closes the panel", async () => {
    vi.spyOn(PgChatSync, "pushAll").mockRejectedValue(new Error("offline"));
    serverSignsOut({ ok: true });

    const effect = await mount();
    await PgSession.signOut();

    // The threads were not uploaded, so nothing is forgotten and they are
    // still there for the next sign-in. What must not survive is the
    // *rendered* thread, which would be re-persisted on the next change.
    expect(PgChatSync.forget).toHaveBeenCalledWith(null);
    expect(order).toContain("closeThread");
    effect.dispose();
  });

  it("forgets the account even when a step before it fails", async () => {
    vi.spyOn(restore, "releaseLocalProjects").mockRejectedValue(
      new Error("quota")
    );
    serverSignsOut({ ok: true });
    PgProjectSync.raise({ projectId: "tut:hello", kind: "divergent" });

    const effect = await mount();
    await PgSession.signOut();

    // A tutorial's id is identical across accounts, so a banner left over from
    // the last user is a question the next one cannot answer
    expect(PgProjectSync.conflictFor("tut:hello")).toBeNull();
    effect.dispose();
  });
});
