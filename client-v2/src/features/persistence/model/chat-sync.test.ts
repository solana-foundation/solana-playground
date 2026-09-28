import { v4 as uuid } from "uuid";

import { PgChatStorage } from "./chat-storage";
import { PgChatSync } from "./chat-sync";
import { PgSyncClient } from "./sync-client";
import { PgThreadIndex } from "./thread-index";
import { PgSession } from "../../auth";
import { PgFs } from "../../../utils/explorer/fs";
import type {
  BackendParams,
  ChatItem,
} from "../../../views/sidebar/assistant/store";

/**
 * A minted id, but the same one every time a key is asked for.
 *
 * The merge test writes `item(2)` locally and has the server answer with
 * `item(2)` as well, and proves the pull does not duplicate it -- which only
 * means anything while the two share an id. So the ids are real uuids rather
 * than hand-written strings, and stable rather than fresh per call.
 */
const minted = new Map<string, string>();
const idOf = (key: string): string => {
  const known = minted.get(key);
  if (known) return known;

  const fresh = uuid();
  minted.set(key, fresh);
  return fresh;
};

const item = (n: number): ChatItem => ({
  kind: "user",
  id: idOf(`item:${n}`),
  createdAt: new Date(n * 1000).toISOString(),
  text: `m${n}`,
});

const reply = (n: number, origin?: BackendParams): ChatItem => ({
  kind: "assistant",
  id: idOf(`reply:${n}`),
  createdAt: new Date(n * 1000).toISOString(),
  text: `r${n}`,
  ...(origin ? { origin } : {}),
});

/** Only `id` matters to sync; the rest of the session user is display */
const signedIn = () =>
  PgSession.refreshWith({ id: "u1", name: null, image: null, login: null });

/**
 * The spy standing in for `fetch`, reinstalled for each test.
 *
 * `jest.spyOn` rather than assigning `global.fetch`: `restoreAllMocks` then
 * puts the global back afterwards, so a stub one test installed cannot answer
 * the next one's request. The stand-in it replaces comes from
 * `setupTests.ts`, because jsdom has no `fetch` of its own to spy on.
 */
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.spyOn(globalThis, "fetch") as unknown as jest.Mock;
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** `/api/sync` says yes; everything else is the caller's to describe */
const respondingWith = (rest: (url: string) => unknown) =>
  fetchMock.mockImplementation((url: string) =>
    url === "/api/sync"
      ? Promise.resolve({
          ok: true,
          json: async () => ({ enabled: true, db: "ok" }),
        })
      : rest(url)
  );

/** The body of the one POST that was made */
const postedBody = () => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
  return JSON.parse(call![1].body);
};

describe("PgChatSync", () => {
  /** A workspace with a thread on it, which is what push needs to name one */
  let threadId: string;

  beforeEach(async () => {
    await PgChatStorage.clear();
    await PgThreadIndex.clear();
    PgSession.reset();
    PgSyncClient.reset();
    threadId = await PgThreadIndex.ensure("w1");
  });

  it("does nothing when signed out", async () => {
    await PgChatStorage.write(threadId, [item(1)]);

    await PgChatSync.push(threadId);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the local thread when signed in", async () => {
    respondingWith(() =>
      Promise.resolve({ ok: true, json: async () => ({ written: 1 }) })
    );
    await signedIn();
    await PgChatStorage.write(threadId, [item(1)]);

    await PgChatSync.push(threadId);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/conversations",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("names the thread and its workspace, so the server can key both", async () => {
    respondingWith(() =>
      Promise.resolve({ ok: true, json: async () => ({ written: 1 }) })
    );
    await signedIn();
    await PgChatStorage.write(threadId, [item(1)]);

    await PgChatSync.push(threadId);

    expect(postedBody()).toMatchObject({ threadId, projectId: "w1" });
  });

  it("never sends the API key, under any name", async () => {
    respondingWith(() =>
      Promise.resolve({ ok: true, json: async () => ({ written: 1 }) })
    );
    await signedIn();
    await PgChatStorage.write(threadId, [
      item(1),
      reply(2, { provider: "anthropic", model: "claude-opus-5" }),
    ]);

    await PgChatSync.push(threadId);

    const body = postedBody();
    // The backend a reply came from rides along, inside the message that
    // produced it -- the thread itself records no backend at all
    expect(body.items[1].origin).toEqual({
      provider: "anthropic",
      model: "claude-opus-5",
    });
    expect(JSON.stringify(body)).not.toMatch(/apiKey|"key"|token|sk-/);
  });

  it("refuses to push a thread the index cannot place", async () => {
    respondingWith(() =>
      Promise.resolve({ ok: true, json: async () => ({ written: 1 }) })
    );
    await signedIn();
    const unknown = uuid();
    await PgChatStorage.write(unknown, [item(1)]);

    const ok = await PgChatSync.push(unknown);

    expect(ok).toBe(false);
  });

  it("keeps the local thread when the push fails, so nothing is lost", async () => {
    respondingWith(() => Promise.reject(new Error("offline")));
    await signedIn();
    await PgChatStorage.write(threadId, [item(1)]);

    const handed = await PgChatSync.pushAll();

    expect(handed).toEqual({ pushed: [], complete: false });
    expect(await PgChatStorage.read(threadId)).toHaveLength(1);
  });

  it("merges the server thread with local items on pull, without duplicates", async () => {
    respondingWith(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ items: [item(1), item(2)] }),
      })
    );
    await signedIn();
    await PgChatStorage.write(threadId, [item(2), item(3)]);

    const merged = await PgChatSync.pull(threadId);

    expect(merged!.map((i) => (i as { text: string }).text)).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
  });

  it("pulls by thread id, not by workspace", async () => {
    respondingWith(() =>
      Promise.resolve({ ok: true, json: async () => ({ items: [] }) })
    );
    await signedIn();

    await PgChatSync.pull(threadId);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/conversations?threadId=${threadId}`,
      expect.anything()
    );
  });

  it("treats a thread the server has never seen as nothing to merge", async () => {
    respondingWith(() =>
      Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    );
    await signedIn();
    await PgChatStorage.write(threadId, [item(1)]);
    PgChatStorage.clearLastFailure();

    expect(await PgChatSync.pull(threadId)).toBeNull();
    expect(await PgChatStorage.read(threadId)).toHaveLength(1);
    // Not a fault: a thread that has never been pushed is simply not there
    expect(PgChatStorage.lastFailure).toBeNull();
  });

  it("leaves the local thread alone when the server cannot be reached", async () => {
    respondingWith(() => Promise.reject(new Error("offline")));
    await signedIn();
    await PgChatStorage.write(threadId, [item(1)]);

    expect(await PgChatSync.pull(threadId)).toBeNull();
    expect(await PgChatStorage.read(threadId)).toHaveLength(1);
  });

  it("stays local when the deployment has no database", async () => {
    fetchMock.mockImplementation((url: string) =>
      url === "/api/sync"
        ? Promise.resolve({
            ok: true,
            json: async () => ({ enabled: false, db: "unconfigured" }),
          })
        : Promise.reject(new Error("should not be called"))
    );
    await signedIn();
    await PgChatStorage.write(threadId, [item(1)]);

    expect(await PgChatSync.push(threadId)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("handing conversations over at sign-out", () => {
  const mockFiles = (PgFs as unknown as { __files: Map<string, string> })
    .__files;

  const accepted = () =>
    respondingWith(() =>
      Promise.resolve({ ok: true, json: async () => ({ written: 1 }) })
    );

  /** A thread the index can place, which is what `push` needs */
  let threadId: string;

  beforeEach(async () => {
    await PgChatStorage.clear();
    await PgThreadIndex.clear();
    PgSession.reset();
    PgSyncClient.reset();
    threadId = await PgThreadIndex.ensure("w1");
  });

  it("clears local threads once the server has them", async () => {
    accepted();
    await signedIn();
    await PgChatStorage.write(threadId, [item(1)]);

    await PgChatSync.handOver();

    expect(await PgChatStorage.threadIds()).toEqual([]);
  });

  it("keeps them when a push failed", async () => {
    respondingWith(() =>
      Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
    );
    await signedIn();
    await PgChatStorage.write(threadId, [item(1)]);

    await PgChatSync.handOver();

    expect(await PgChatStorage.read(threadId)).toHaveLength(1);
  });

  it("drops the threads the server took and keeps only the one that failed", async () => {
    // This used to be all-or-nothing. One thread failing to upload kept every
    // other thread on the device as well -- including ones the account
    // demonstrably already held -- so a single flaky request handed the next
    // user of this browser the whole transcript, and nothing was gained for
    // it: the failed thread is kept either way.
    const second = await PgThreadIndex.ensure("w2");
    const third = await PgThreadIndex.ensure("w3");
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/sync") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ enabled: true, db: "ok" }),
        });
      }
      const body = JSON.parse(String(init?.body));
      return Promise.resolve(
        body.threadId === second
          ? { ok: false, status: 500, json: async () => ({}) }
          : { ok: true, json: async () => ({ written: 1 }) }
      );
    });
    await signedIn();
    await PgChatStorage.write(threadId, [item(1)]);
    await PgChatStorage.write(second, [item(2)]);
    await PgChatStorage.write(third, [item(3)]);

    await PgChatSync.handOver();

    expect((await PgChatStorage.threadIds())?.sort()).toEqual([second]);
    expect(await PgChatStorage.read(second)).toHaveLength(1);
  });

  it("keeps them when the threads could not even be listed", async () => {
    // `[].every(Boolean)` is `true`. An enumeration that failed used to answer
    // the same as an account with no conversations, and sign-out deleted every
    // thread on the device having uploaded none of them.
    accepted();
    await signedIn();
    await PgChatStorage.write(threadId, [item(1)]);
    jest.spyOn(PgFs, "readDir").mockRejectedValue(new Error("quota"));

    expect(await PgChatSync.pushAll()).toBeNull();

    jest.restoreAllMocks();
    expect(await PgChatStorage.read(threadId)).toHaveLength(1);
  });

  it("does not report a thread it could not read as uploaded", async () => {
    // Same shape one level down: an unreadable thread read as an empty one,
    // and `push` reported success for a thread the server never saw -- which
    // is what then let `handOver` delete the one file worth recovering
    accepted();
    await signedIn();
    await PgChatStorage.write(threadId, [item(1)]);
    mockFiles.set(`/.config/chats/${threadId}.json`, "{ not json");

    expect(await PgChatSync.push(threadId)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/conversations",
      expect.anything()
    );
  });

  it("still reports a genuinely empty thread as handed over", async () => {
    accepted();
    await signedIn();

    expect(await PgChatSync.push(await PgThreadIndex.ensure("w9"))).toBe(true);
  });
});

describe("pulling a thread that cannot be read locally", () => {
  const mockFiles = (PgFs as unknown as { __files: Map<string, string> })
    .__files;

  let threadId: string;

  beforeEach(async () => {
    await PgChatStorage.clear();
    await PgThreadIndex.clear();
    PgSession.reset();
    PgSyncClient.reset();
    threadId = await PgThreadIndex.ensure("w1");
  });

  it("does not overwrite the local file with the server's half", async () => {
    // `pull` merges local into server and writes the result back. With the
    // local read answering `[]` for a file it could not parse, that write
    // replaces a recoverable file with the server's copy alone -- destroying
    // exactly the messages that had not been uploaded.
    respondingWith(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ items: [] }),
      })
    );
    await signedIn();
    await PgChatStorage.write(threadId, [item(1)]);
    const corrupt = "{ not json";
    mockFiles.set(`/.config/chats/${threadId}.json`, corrupt);

    await PgChatSync.pull(threadId);

    expect(mockFiles.get(`/.config/chats/${threadId}.json`)).toBe(corrupt);
  });
});

describe("finding the account's thread for a workspace", () => {
  /**
   * Sign-out clears the thread index, so the next open mints a fresh thread
   * id -- and a pull by that id 404s while the account's conversation sits on
   * the server under the old one.
   */
  let minted: string;
  const accountThread = uuid();

  /** The project's threads, newest first; POSTs and pulls are accepted */
  const serverHolds = (ids: string[]) =>
    respondingWith((url) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          url.includes("projectId=")
            ? { threads: ids.map((id) => ({ id })) }
            : { items: [] },
      })
    );

  beforeEach(async () => {
    await PgChatStorage.clear();
    await PgThreadIndex.clear();
    PgSession.reset();
    PgSyncClient.reset();
    minted = await PgThreadIndex.ensure("w1");
  });

  it("asks by project and repoints the workspace at the newest thread", async () => {
    serverHolds([accountThread, uuid()]);
    await signedIn();

    expect(await PgChatSync.adoptAccountThread("w1")).toBe(accountThread);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/conversations?projectId=w1",
      expect.anything()
    );
    expect(await PgThreadIndex.get("w1")).toBe(accountThread);
  });

  it("carries what was typed locally into the account's thread", async () => {
    serverHolds([accountThread]);
    await signedIn();
    await PgChatStorage.write(minted, [item(3)]);
    await PgChatStorage.write(accountThread, [item(1)]);

    await PgChatSync.adoptAccountThread("w1");

    expect(await PgChatStorage.read(accountThread)).toEqual([item(1), item(3)]);
    expect(await PgChatStorage.threadIds()).toEqual([accountThread]);
  });

  it("leaves a thread the server already knows alone", async () => {
    serverHolds([uuid(), minted]);
    await signedIn();

    expect(await PgChatSync.adoptAccountThread("w1")).toBeNull();
    expect(await PgThreadIndex.get("w1")).toBe(minted);
  });

  it("keeps the minted thread when the account has none for the project", async () => {
    serverHolds([]);
    await signedIn();

    expect(await PgChatSync.adoptAccountThread("w1")).toBeNull();
    expect(await PgThreadIndex.get("w1")).toBe(minted);
  });

  it("keeps the local thread when the server cannot be reached", async () => {
    respondingWith(() => Promise.reject(new Error("offline")));
    await signedIn();
    await PgChatStorage.write(minted, [item(1)]);

    expect(await PgChatSync.adoptAccountThread("w1")).toBeNull();
    expect(await PgThreadIndex.get("w1")).toBe(minted);
    expect(await PgChatStorage.read(minted)).toHaveLength(1);
  });

  it("does nothing when signed out", async () => {
    await PgChatSync.adoptAccountThreads();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adopts for every workspace in the index", async () => {
    await PgThreadIndex.ensure("w2");
    const other = uuid();
    respondingWith((url) =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          threads: [{ id: url.endsWith("w1") ? accountThread : other }],
        }),
      })
    );
    await signedIn();

    await PgChatSync.adoptAccountThreads();

    expect(await PgThreadIndex.get("w1")).toBe(accountThread);
    expect(await PgThreadIndex.get("w2")).toBe(other);
  });
});
