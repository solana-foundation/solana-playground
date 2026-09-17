import { PgAssistant, turnProducedApproval, type ChatItem } from "./store";
import { isDefaultBackendRemembered } from "./model/remembered-backend";
import { PgChatStorage } from "../../../features/persistence/model/chat-storage";
import { PgFs } from "../../../utils/explorer/fs";

/** Storage writes are fired and forgotten; this waits for them to land */
const settled = () => PgAssistant.whenPersisted();

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

describe("PgAssistant backend memory", () => {
  beforeEach(() => {
    localStorage.clear();
    PgAssistant.disconnect();
  });

  it("remembers the default backend, so the next load reconnects itself", () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    expect(isDefaultBackendRemembered()).toBe(true);
  });

  it("does not remember a backend the user had to bring a key for", () => {
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
  });

  it("writes the open thread through to storage on every change", async () => {
    await PgAssistant.loadThread("t1");
    PgAssistant.addUserMessage("hi");
    await settled();

    expect(await PgChatStorage.read("t1")).toHaveLength(1);
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

    // A reload leaves no connection behind -- it is in memory only -- so the
    // first thing the user does is connect, and that must not be mistaken for
    // switching away from a backend they were already talking to
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
