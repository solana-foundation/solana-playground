import { MAX_MESSAGES_PER_THREAD, PgChatStorage } from "./chat-storage";
import { PgFs } from "../../../utils/explorer/fs";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

/** The mock's own store, for corrupting a file or asserting on one */
const mockFiles = (PgFs as unknown as { __files: Map<string, string> }).__files;

beforeEach(() => mockFiles.clear());

const item = (n: number): ChatItem => ({
  kind: "user",
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  createdAt: new Date(n * 1000).toISOString(),
  text: `m${n}`,
});

describe("PgChatStorage", () => {
  it("round-trips a thread", async () => {
    await PgChatStorage.write("t1", [item(1), item(2)]);

    expect(await PgChatStorage.read("t1")).toEqual([item(1), item(2)]);
  });

  it("keeps threads apart", async () => {
    await PgChatStorage.write("t1", [item(1)]);
    await PgChatStorage.write("t2", [item(2)]);

    expect(await PgChatStorage.read("t1")).toEqual([item(1)]);
    expect(await PgChatStorage.read("t2")).toEqual([item(2)]);
  });

  it("returns an empty thread for an unknown id", async () => {
    expect(await PgChatStorage.read("nope")).toEqual([]);
  });

  it("handles a tutorial id, which is not a plain file name", async () => {
    // `tut:hello-anchor` carries a colon, and thread ids become file names
    await PgChatStorage.write("tut:hello-anchor", [item(1)]);

    expect(await PgChatStorage.read("tut:hello-anchor")).toEqual([item(1)]);
    expect(await PgChatStorage.threadIds()).toContain("tut:hello-anchor");
  });

  it("keeps only the newest messages past the per-thread cap", async () => {
    const many = Array.from({ length: MAX_MESSAGES_PER_THREAD + 10 }, (_, i) =>
      item(i)
    );

    await PgChatStorage.write("t1", many);

    const read = await PgChatStorage.read("t1");
    expect(read).toHaveLength(MAX_MESSAGES_PER_THREAD);
    expect(read[read.length - 1]).toEqual(many[many.length - 1]);
    expect(read[0]).toEqual(many[10]);
  });

  it("lists and removes threads", async () => {
    await PgChatStorage.write("t1", [item(1)]);
    await PgChatStorage.write("t2", [item(2)]);

    expect((await PgChatStorage.threadIds()).sort()).toEqual(["t1", "t2"]);

    await PgChatStorage.remove("t1");

    expect(await PgChatStorage.threadIds()).toEqual(["t2"]);
    expect(await PgChatStorage.read("t1")).toEqual([]);
  });

  it("survives a hand-corrupted file rather than losing the panel", async () => {
    await PgChatStorage.write("t1", [item(1)]);
    mockFiles.set("/.config/chats/t1.json", "{ not json");

    expect(await PgChatStorage.read("t1")).toEqual([]);
  });

  describe("failure reporting", () => {
    // Every method still catches -- losing a write must not take the panel
    // down -- but "it broke" must be distinguishable from "there is nothing
    // here", or a storage fault looks exactly like an empty conversation.
    beforeEach(() => PgChatStorage.clearLastFailure());

    it("says nothing about a thread that simply does not exist", async () => {
      expect(await PgChatStorage.read("never-written")).toEqual([]);
      expect(PgChatStorage.lastFailure).toBeNull();
    });

    it("records a read that failed, rather than reporting an empty thread", async () => {
      await PgChatStorage.write("t1", [item(1)]);
      mockFiles.set("/.config/chats/t1.json", "{ not json");

      expect(await PgChatStorage.read("t1")).toEqual([]);
      expect(PgChatStorage.lastFailure?.what).toMatch(/read t1/);
    });

    it("records a write that failed", async () => {
      const spy = jest
        .spyOn(PgFs, "writeFile")
        .mockRejectedValueOnce(new Error("quota"));

      await PgChatStorage.write("t1", [item(1)]);

      expect(PgChatStorage.lastFailure?.what).toMatch(/write t1/);
      spy.mockRestore();
    });

    it("records items dropped as unreadable, which are otherwise invisible", async () => {
      await PgChatStorage.write("t1", [item(1)]);
      mockFiles.set(
        "/.config/chats/t1.json",
        JSON.stringify([item(1), { kind: "bogus", id: "x" }])
      );

      expect(await PgChatStorage.read("t1")).toHaveLength(1);
      expect(PgChatStorage.lastFailure?.what).toMatch(/dropped/);
    });
  });

  it("does not throw when the write fails", async () => {
    // Losing a write must never take the panel down with it
    const spy = jest
      .spyOn(PgFs, "writeFile")
      .mockRejectedValueOnce(new Error("quota"));

    await expect(PgChatStorage.write("t1", [item(1)])).resolves.toBeUndefined();

    spy.mockRestore();
  });

  it("clears every thread it owns", async () => {
    await PgChatStorage.write("t1", [item(1)]);
    await PgChatStorage.write("t2", [item(2)]);

    await PgChatStorage.clear();

    expect(await PgChatStorage.threadIds()).toEqual([]);
  });

  it("encodes patch approvals on the way in", async () => {
    const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const approval: ChatItem = {
      kind: "approval",
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "pending",
      request: {
        type: "patch",
        path: "src/lib.rs",
        before: big,
        after: big.replace("line 100", "changed"),
      },
    };

    await PgChatStorage.write("t1", [approval]);

    const [read] = await PgChatStorage.read("t1");
    if (read.kind !== "approval" || read.request.type !== "patch") {
      throw new Error("expected a stored patch approval");
    }
    // Trimmed to the changed region, and a pending card cannot be resumed so
    // it is stored as denied rather than left spinning
    expect(read.request.before!.length).toBeLessThan(big.length / 4);
    expect(read.status).toBe("denied");
  });
});
