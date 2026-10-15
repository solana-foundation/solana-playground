import {
  KEY_NOT_FORGOTTEN,
  PgAssistant,
  turnProducedApproval,
  type ChatItem,
} from "./store";
import { MIN_REDACTED_KEY_LENGTH, REDACTED_KEY } from "./model/redact-key";
import { isDefaultBackendRemembered } from "./model/remembered-backend";
import {
  MAX_MESSAGES_PER_THREAD,
  PgChatStorage,
  truncationNoticeId,
} from "../../../features/persistence/model/chat-storage";
// Through `@/` on purpose: the alias is mapped in `tsconfig.json`'s `paths`, in
// craco's webpack alias and in `vitest.config.ts`'s `resolve.alias`, and this
// import is what fails when the vitest mapping drifts from the other two.
import { PgFs } from "@/utils/explorer/fs";
import { storedValues } from "../../../test-utils/stored-values";

/** Storage writes are fired and forgotten; this waits for them to land */
const settled = () => PgAssistant.whenPersisted();

/** The id of the approval card added most recently */
const latestCard = () =>
  PgAssistant.items.filter((i) => i.kind === "approval").slice(-1)[0].id;

const at = "2026-01-01T00:00:00.000Z";

const user = (text: string): ChatItem => ({
  kind: "user",
  id: "u",
  createdAt: at,
  text,
});
const assistant = (text: string): ChatItem => ({
  kind: "assistant",
  id: "a",
  createdAt: at,
  text,
});
const approval: ChatItem = {
  kind: "approval",
  id: "p",
  createdAt: at,
  request: { type: "patch", path: "src/lib.rs", before: "a", after: "b" },
  status: "allowed",
};

describe("turnProducedApproval", () => {
  it("is false for a turn that only replied", () => {
    expect(turnProducedApproval([user("hi"), assistant("hello")])).toBe(false);
  });

  it("is true when this turn wrote a patch before replying", () => {
    expect(
      turnProducedApproval([
        user("write it"),
        approval,
        assistant("I added the hello instruction."),
      ])
    ).toBe(true);
  });

  it("does not look past the start of the current turn", () => {
    expect(
      turnProducedApproval([
        user("write it"),
        approval,
        assistant("done"),
        user("what does it do?"),
        assistant("it logs a message"),
      ])
    ).toBe(false);
  });

  it("is false for an empty conversation", () => {
    expect(turnProducedApproval([])).toBe(false);
  });
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("PgAssistant item identity", () => {
  beforeEach(() => PgAssistant.clear());

  it("gives every item a uuid, not a session counter", () => {
    PgAssistant.addUserMessage("hi");

    expect(PgAssistant.items[0].id).toMatch(UUID_RE);
  });

  it("stamps every item with a creation time", () => {
    PgAssistant.addUserMessage("hi");

    expect(Number.isNaN(Date.parse(PgAssistant.items[0].createdAt))).toBe(
      false
    );
  });

  it("does not reuse ids across a clear, unlike the old counter", () => {
    PgAssistant.addUserMessage("first");
    const first = PgAssistant.items[0].id;

    PgAssistant.clear();
    PgAssistant.addUserMessage("second");

    expect(PgAssistant.items[0].id).not.toBe(first);
  });

  it("stamps every kind of item, not just user messages", () => {
    PgAssistant.addUserMessage("hi");
    PgAssistant.startAssistantMessage();
    PgAssistant.addToolCall("read src/lib.rs");
    PgAssistant.addNotice("stopped");
    PgAssistant.addError("boom");

    expect(PgAssistant.items).toHaveLength(5);
    for (const item of PgAssistant.items) {
      expect(item.id).toMatch(UUID_RE);
      expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false);
    }
  });

  it("keeps ids unique across many items", () => {
    for (let i = 0; i < 50; i++) PgAssistant.addUserMessage(`m${i}`);

    const ids = new Set(PgAssistant.items.map((i) => i.id));
    expect(ids.size).toBe(50);
  });
});

/**
 * Items change after they are created -- a reply streams in, an approval is
 * answered -- and the server keeps whichever copy of an id is newer. So every
 * change to an existing item has to say when it happened.
 */
describe("PgAssistant item versions", () => {
  beforeEach(() => PgAssistant.clear());

  /** An item's version: when it last changed, or when it was made */
  const versionOf = (item: ChatItem) =>
    Date.parse(item.updatedAt ?? item.createdAt);

  const find = (id: string) => PgAssistant.items.find((i) => i.id === id)!;

  it("leaves a new item unstamped, so its version is its creation", () => {
    PgAssistant.addUserMessage("hi");
    const id = PgAssistant.startAssistantMessage();

    expect(PgAssistant.items[0].updatedAt).toBeUndefined();
    expect(find(id).updatedAt).toBeUndefined();
  });

  it("stamps a reply each time text streams into it", () => {
    const id = PgAssistant.startAssistantMessage();
    const created = versionOf(find(id));

    PgAssistant.appendToAssistantMessage(id, "Hel");
    const first = versionOf(find(id));
    PgAssistant.appendToAssistantMessage(id, "lo");
    const second = versionOf(find(id));

    expect(first).toBeGreaterThan(created);
    // Strictly, even when two deltas land in the same millisecond: a tie
    // would let the server keep the shorter copy
    expect(second).toBeGreaterThan(first);
  });

  it("stamps an approval when the user answers it", () => {
    void PgAssistant.requestApproval({
      type: "command",
      name: "build",
      effect: "builds",
    });
    const id = latestCard();
    const created = versionOf(find(id));

    PgAssistant.resolveApproval(id, true);

    expect(versionOf(find(id))).toBeGreaterThan(created);
  });

  it("stamps an approval when its outcome is recorded", () => {
    void PgAssistant.requestApproval({
      type: "command",
      name: "build",
      effect: "builds",
    });
    const id = latestCard();
    PgAssistant.resolveApproval(id, true);
    const answered = versionOf(find(id));

    PgAssistant.setApprovalOutcome(id, "built");

    expect(versionOf(find(id))).toBeGreaterThan(answered);
  });

  it("stamps an approval denied because the turn was stopped", () => {
    void PgAssistant.requestApproval({
      type: "command",
      name: "deploy",
      effect: "deploys",
    });
    const id = latestCard();
    const created = versionOf(find(id));

    PgAssistant.cancelPending();

    expect(versionOf(find(id))).toBeGreaterThan(created);
  });

  it("writes the stamp to storage with the item", async () => {
    PgAssistant.closeThread();
    (PgFs as unknown as { __files: Map<string, string> }).__files.clear();
    await PgAssistant.loadThread("versions");
    const id = PgAssistant.startAssistantMessage();
    PgAssistant.appendToAssistantMessage(id, "done");
    await settled();

    const [stored] = (await PgChatStorage.read("versions"))!;
    expect(stored.updatedAt).toEqual(expect.any(String));
    expect(stored.updatedAt).toBe(find(id).updatedAt);
    PgAssistant.closeThread();
  });
});

/**
 * The server's copy of the open thread, merged into memory rather than
 * reloaded from storage -- a reload denies pending approvals, resets the
 * status, and replaces memory with a copy on disk that can lag it.
 */
describe("PgAssistant.foldIn", () => {
  const files = () =>
    (PgFs as unknown as { __files: Map<string, string> }).__files;

  beforeEach(async () => {
    files().clear();
    PgAssistant.closeThread();
    PgAssistant.clear();
    await PgAssistant.loadThread("fold");
  });

  afterEach(() => PgAssistant.closeThread());

  const reply = (text: string, updatedAt?: string): ChatItem => ({
    kind: "assistant",
    id: "66666666-6666-4666-8666-666666666666",
    createdAt: at,
    text,
    ...(updatedAt ? { updatedAt } : {}),
  });

  const texts = () =>
    PgAssistant.items.map((i) => ("text" in i ? i.text : i.kind));

  it("adds the server's items and keeps the ones only this tab has", async () => {
    PgAssistant.addUserMessage("local only");

    await PgAssistant.foldIn("fold", [reply("from the server")]);

    expect(texts()).toEqual(["from the server", "local only"]);
    await settled();
    expect(await PgChatStorage.read("fold")).toHaveLength(2);
  });

  it("takes the server's copy of an item when it is newer", async () => {
    await PgAssistant.foldIn("fold", [reply("Do", "2026-01-01T00:00:01.000Z")]);

    await PgAssistant.foldIn("fold", [
      reply("Done.", "2026-01-01T00:00:05.000Z"),
    ]);

    expect(texts()).toEqual(["Done."]);
  });

  it("keeps this tab's copy when it is newer, or on a tie", async () => {
    await PgAssistant.foldIn("fold", [
      reply("Done.", "2026-01-01T00:00:05.000Z"),
    ]);

    await PgAssistant.foldIn("fold", [reply("Do", "2026-01-01T00:00:01.000Z")]);
    await PgAssistant.foldIn("fold", [
      reply("other", "2026-01-01T00:00:05.000Z"),
    ]);

    expect(texts()).toEqual(["Done."]);
  });

  it("leaves a running turn running, and its approval waiting", async () => {
    PgAssistant.setStatus("running");
    const id = PgAssistant.startAssistantMessage();
    const approval = PgAssistant.requestApproval({
      type: "command",
      name: "build",
      effect: "builds",
    });
    const card = latestCard();

    // The server's copy of the card reads as unanswered: the codec stores a
    // pending one that way. Same version, so this tab's copy stands.
    const asked = PgAssistant.items.find((i) => i.id === card)!;
    await PgAssistant.foldIn("fold", [
      {
        kind: "approval",
        id: asked.id,
        createdAt: asked.createdAt,
        request: { type: "command", name: "build", effect: "builds" },
        status: "unanswered",
      },
    ]);

    expect(PgAssistant.status).toBe("awaiting");
    expect(PgAssistant.items.find((i) => i.id === card)).toMatchObject({
      status: "pending",
    });

    // The reply still streams into the item the turn is holding
    PgAssistant.appendToAssistantMessage(id, "Hi");
    expect(texts()).toContain("Hi");

    PgAssistant.resolveApproval(card, true);
    await expect(approval).resolves.toEqual({ id: card, allowed: true });
  });

  it("writes nothing when the server had nothing new", async () => {
    PgAssistant.addUserMessage("hi");
    await settled();
    const write = vi.spyOn(PgChatStorage, "write");

    await PgAssistant.foldIn("fold", [...PgAssistant.items]);
    await settled();

    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it("does nothing for a thread that is not open", async () => {
    expect(await PgAssistant.foldIn("other", [reply("elsewhere")])).toBe(false);

    expect(PgAssistant.items).toHaveLength(0);
  });

  it("waits for the thread's read, so the stored items are not added twice", async () => {
    // A fold into the empty list standing in for the thread, followed by the
    // read landing, appended the stored thread to the server's copy as though
    // every item had arrived mid-read
    const stored = reply("stored");
    await PgChatStorage.write("racy", [stored]);
    PgAssistant.closeThread();

    const loading = PgAssistant.loadThread("racy");
    const folded = PgAssistant.foldIn("racy", [stored]);
    await Promise.all([loading, folded]);

    expect(texts()).toEqual(["stored"]);
  });

  describe("on a thread longer than this device keeps", () => {
    /** `n` server messages, oldest first, a second apart */
    const history = (n: number) =>
      Array.from(
        { length: n },
        (_, i): ChatItem => ({
          kind: "user",
          id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, i)).toISOString(),
          text: `m${i}`,
        })
      );

    it("keeps only the newest, as storage would", async () => {
      // The server keeps every message; memory held all of them under a
      // notice saying the earlier ones were not on this device
      await PgAssistant.foldIn("fold", history(MAX_MESSAGES_PER_THREAD + 50));

      expect(PgAssistant.items).toHaveLength(MAX_MESSAGES_PER_THREAD);
      expect(PgAssistant.items[0].id).toBe(truncationNoticeId("fold"));
      expect(texts()).toContain(`m${MAX_MESSAGES_PER_THREAD + 49}`);
    });

    it("writes nothing when folding the same history again", async () => {
      const server = history(MAX_MESSAGES_PER_THREAD + 50);
      await PgAssistant.foldIn("fold", server);
      await settled();
      const write = vi.spyOn(PgChatStorage, "write");

      await PgAssistant.foldIn("fold", server);

      expect(write).not.toHaveBeenCalled();
      write.mockRestore();
    });

    it("never trims what a long session already shows", async () => {
      const server = history(MAX_MESSAGES_PER_THREAD);
      await PgAssistant.foldIn("fold", server);
      for (let i = 0; i < 20; i++) PgAssistant.addUserMessage(`new ${i}`);
      const shown = PgAssistant.items.map((i) => i.id).sort();

      await PgAssistant.foldIn("fold", server);

      expect(PgAssistant.items.map((i) => i.id).sort()).toEqual(shown);
    });
  });
});

describe("PgAssistant reply provenance", () => {
  beforeEach(() => {
    localStorage.clear();
    PgAssistant.disconnect();
    PgAssistant.clear();
  });

  it("records the backend that wrote a reply", () => {
    PgAssistant.connect({
      id: "openai",
      apiKey: "sk-test",
      endpoint: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.1" },
    });

    PgAssistant.startAssistantMessage();

    expect(PgAssistant.items[0]).toMatchObject({
      origin: {
        provider: "openai",
        model: "gpt-5.1",
        baseUrl: "https://api.openai.com/v1",
      },
    });
  });

  it("never records the key", () => {
    PgAssistant.connect({ id: "anthropic", apiKey: "sk-ant-secret" });

    PgAssistant.startAssistantMessage();

    expect(JSON.stringify(PgAssistant.items)).not.toContain("sk-ant-secret");
  });

  it("records nothing when nothing is connected", () => {
    PgAssistant.startAssistantMessage();

    expect(PgAssistant.items[0]).not.toHaveProperty("origin");
  });

  it("follows the user switching backends mid-thread", () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    PgAssistant.startAssistantMessage();

    PgAssistant.connect({
      id: "gemini",
      apiKey: "k",
      endpoint: { baseUrl: "https://g", model: "gemini-3.6-flash" },
    });
    PgAssistant.startAssistantMessage();

    // Switching backends clears the conversation, so the second reply stands
    // alone -- but it stands alone carrying the backend that produced it
    expect(PgAssistant.items[0]).toMatchObject({
      origin: { provider: "gemini", model: "gemini-3.6-flash" },
    });
  });
});

describe("PgAssistant backend memory", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    PgAssistant.disconnect();
  });

  it("remembers the default backend, so the next load reconnects itself", () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    expect(isDefaultBackendRemembered()).toBe(true);
  });

  it("does not remember a key-based backend as the default", () => {
    PgAssistant.connect({ id: "anthropic", apiKey: "sk-test" });
    expect(isDefaultBackendRemembered()).toBe(false);
  });

  it("forgets the default once the user switches away from it", () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    PgAssistant.connect({ id: "anthropic", apiKey: "sk-test" });
    expect(isDefaultBackendRemembered()).toBe(false);
  });

  it("forgets the default when the user disconnects", () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    PgAssistant.disconnect();
    expect(isDefaultBackendRemembered()).toBe(false);
  });
});

describe("PgAssistant threads", () => {
  beforeEach(() => {
    // Straight at the mock's store: `PgChatStorage.clear()` swallows its own
    // failures, so a clear that silently did nothing would look identical
    (PgFs as unknown as { __files: Map<string, string> }).__files.clear();
    // `clear` keeps the open thread on purpose, so close it explicitly or a
    // previous test's thread keeps receiving writes
    PgAssistant.closeThread();
    // And `closeThread` leaves items alone when no thread is open, so that a
    // message typed before one resolves is adopted rather than dropped --
    // which means a previous case's orphan would follow us in here
    PgAssistant.clear();
  });

  it("writes the open thread through to storage on every change", async () => {
    await PgAssistant.loadThread("t1");
    PgAssistant.addUserMessage("hi");
    await settled();

    expect(await PgChatStorage.read("t1")).toHaveLength(1);
  });

  it("does not write back over a thread it could not read", async () => {
    // The panel renders an unreadable thread as empty, because there is
    // nothing else it can show -- but persisting that empty list would
    // replace a file that may still be recoverable by hand with nothing.
    const files = (PgFs as unknown as { __files: Map<string, string> }).__files;
    const corrupt = "{ not json";
    files.set("/.config/chats/t1.json", corrupt);

    await PgAssistant.loadThread("t1");
    PgAssistant.addUserMessage("hi");
    await settled();

    expect(files.get("/.config/chats/t1.json")).toBe(corrupt);
  });

  it("writes again once a thread reads cleanly", async () => {
    const files = (PgFs as unknown as { __files: Map<string, string> }).__files;
    files.set("/.config/chats/t1.json", "{ not json");
    await PgAssistant.loadThread("t1");

    await PgAssistant.loadThread("t2");
    PgAssistant.addUserMessage("hi");
    await settled();

    expect(await PgChatStorage.read("t2")).toHaveLength(1);
  });

  it("loads a stored thread when switching to it", async () => {
    await PgAssistant.loadThread("t1");
    PgAssistant.addUserMessage("in one");
    await settled();

    await PgAssistant.loadThread("t2");
    expect(PgAssistant.items).toHaveLength(0);

    await PgAssistant.loadThread("t1");
    expect(PgAssistant.items.map((i) => (i as { text: string }).text)).toEqual([
      "in one",
    ]);
  });

  it("keeps threads separate rather than mixing them", async () => {
    await PgAssistant.loadThread("t1");
    PgAssistant.addUserMessage("one");
    await settled();
    await PgAssistant.loadThread("t2");
    PgAssistant.addUserMessage("two");
    await settled();

    expect(await PgChatStorage.read("t1")).toHaveLength(1);
    expect(await PgChatStorage.read("t2")).toHaveLength(1);
  });

  it("does not persist anything when no thread is open", async () => {
    PgAssistant.addUserMessage("orphan");
    await settled();

    expect(await PgChatStorage.threadIds()).toEqual([]);
  });

  it("gives the thread that opens the messages typed before it did", async () => {
    // The panel is mounted before the workspace announces itself, so a
    // message can be sent with nowhere yet to put it. Losing it would be the
    // user watching what they typed disappear.
    PgAssistant.addUserMessage("typed while it was still opening");
    await PgAssistant.loadThread("t1");
    await settled();

    expect(await PgChatStorage.read("t1")).toHaveLength(1);
  });

  it("leaves the previous conversation behind when switching thread", async () => {
    await PgAssistant.loadThread("t1");
    PgAssistant.addUserMessage("in one");
    await settled();

    await PgAssistant.loadThread("t2");
    await settled();

    // Adoption is for messages with no thread, never for another thread's
    expect(PgAssistant.items).toHaveLength(0);
    expect(await PgChatStorage.read("t2")).toHaveLength(0);
  });

  it("does not overwrite a thread when the panel resets on backend switch", async () => {
    await PgAssistant.loadThread("t1");
    PgAssistant.addUserMessage("keep me");
    await settled();

    // `clear` is a render reset, not a conversation the user deleted
    PgAssistant.clear();
    await settled();

    expect(await PgChatStorage.read("t1")).toHaveLength(1);
  });

  it("keeps the restored conversation when a backend is connected", async () => {
    await PgChatStorage.write("t1", [
      {
        kind: "user",
        id: "44444444-4444-4444-8444-444444444444",
        createdAt: at,
        text: "from before the reload",
      },
    ]);

    // A reload starts with no connection in memory, so the first thing the
    // user does is connect, and that must not be mistaken for switching away
    // from a backend they were already talking to
    PgAssistant.disconnect();
    await PgAssistant.loadThread("t1");
    expect(PgAssistant.items).toHaveLength(1);

    PgAssistant.connect({ id: "anthropic", apiKey: "k" });
    await settled();

    expect(PgAssistant.items).toHaveLength(1);
  });

  it("does not overwrite the stored thread when a backend is connected", async () => {
    await PgAssistant.loadThread("t1");
    PgAssistant.addUserMessage("keep me");
    await settled();

    // `clear` leaves storage alone, but whatever follows it must too
    PgAssistant.disconnect();
    PgAssistant.connect({ id: "anthropic", apiKey: "k" });
    await settled();

    expect(await PgChatStorage.read("t1")).toHaveLength(1);
  });

  it("reloads the same thread when forced, after a pull rewrote it", async () => {
    await PgAssistant.loadThread("t1");
    expect(PgAssistant.items).toHaveLength(0);

    await PgChatStorage.write("t1", [
      {
        kind: "user",
        id: "33333333-3333-4333-8333-333333333333",
        createdAt: at,
        text: "from elsewhere",
      },
    ]);

    // Without `force` the unchanged id short-circuits
    await PgAssistant.loadThread("t1");
    expect(PgAssistant.items).toHaveLength(0);

    await PgAssistant.loadThread("t1", true);
    expect(PgAssistant.items).toHaveLength(1);
  });
});

describe("the user's own key", () => {
  const KEY = "sk-test-store-0123456789";
  const openai = {
    id: "openai" as const,
    apiKey: KEY,
    endpoint: { baseUrl: "https://api.example.test/v1", model: "gpt-x" },
  };

  beforeEach(async () => {
    PgAssistant.disconnect();
    sessionStorage.clear();
    localStorage.clear();
    await PgAssistant.loadThread("own-key");
  });

  const errorTexts = () =>
    PgAssistant.items.flatMap((item) =>
      item.kind === "error" ? [item.text] : []
    );

  it("is kept for this tab and nowhere durable", async () => {
    PgAssistant.connect(openai);
    PgAssistant.addUserMessage("hello");
    await settled();

    expect(sessionStorage.getItem("assistant.connection")).toContain(KEY);
    expect(JSON.stringify(storedValues(localStorage))).not.toContain(KEY);
    expect(JSON.stringify(await PgChatStorage.read("own-key"))).not.toContain(
      KEY
    );
  });

  it("is redacted from a provider error before it is stored", async () => {
    PgAssistant.connect(openai);
    PgAssistant.addError(`401: Incorrect API key provided: ${KEY}. Retry.`);
    await settled();

    expect(JSON.stringify(PgAssistant.items)).not.toContain(KEY);
    expect(JSON.stringify(PgAssistant.items)).toContain(REDACTED_KEY);
    expect(JSON.stringify(await PgChatStorage.read("own-key"))).not.toContain(
      KEY
    );
  });

  it("is redacted from an error at exactly the minimum length", () => {
    const apiKey = "a".repeat(MIN_REDACTED_KEY_LENGTH);
    PgAssistant.connect({ id: "openai", apiKey, endpoint: openai.endpoint });
    PgAssistant.addError(`rejected ${apiKey} here`);

    expect(errorTexts()).toEqual([`rejected ${REDACTED_KEY} here`]);
  });

  it("is left alone in an error when it is one short of the minimum", () => {
    const apiKey = "a".repeat(MIN_REDACTED_KEY_LENGTH - 1);
    PgAssistant.connect({ id: "openai", apiKey, endpoint: openai.endpoint });
    PgAssistant.addError(`rejected ${apiKey} here`);

    expect(errorTexts()).toEqual([`rejected ${apiKey} here`]);
  });

  it("is forgotten on disconnect", () => {
    PgAssistant.connect(openai);
    PgAssistant.disconnect();
    expect(sessionStorage.getItem("assistant.connection")).toBeNull();
    expect(PgAssistant.items).toEqual([]);
  });

  it("tells the user to close the tab when disconnecting cannot remove it", async () => {
    PgAssistant.connect(openai);
    PgAssistant.addUserMessage("hello");
    await settled();
    // Neither the removal nor its blanking fallback goes through
    for (const method of ["removeItem", "setItem"] as const) {
      const original = Storage.prototype[method] as (...args: string[]) => void;
      vi.spyOn(Storage.prototype, method).mockImplementation(function (
        this: Storage,
        ...args: string[]
      ) {
        if (this === sessionStorage) throw new Error("blocked");
        original.apply(this, args);
      } as never);
    }

    PgAssistant.disconnect();
    await settled();
    vi.restoreAllMocks();

    expect(PgAssistant.items).toEqual([
      expect.objectContaining({ kind: "notice", text: KEY_NOT_FORGOTTEN }),
    ]);
    // Shown in this tab only: the stored thread keeps its conversation
    expect(JSON.stringify(await PgChatStorage.read("own-key"))).not.toContain(
      KEY_NOT_FORGOTTEN
    );
  });
});
