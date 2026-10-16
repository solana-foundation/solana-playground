import {
  MAX_MESSAGES_PER_THREAD,
  PgChatStorage,
  truncationNoticeId,
  withoutTruncationNotice,
} from "./chat-storage";
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

    const read = (await PgChatStorage.read("t1"))!;
    expect(read).toHaveLength(MAX_MESSAGES_PER_THREAD);
    expect(read[read.length - 1]).toEqual(many[many.length - 1]);
    // One slot goes to the notice saying the rest is gone
    expect(read[1]).toEqual(many[11]);
  });

  describe("the truncation notice", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => item(i));

    it("says so at the top when messages were dropped", async () => {
      await PgChatStorage.write("t1", many(MAX_MESSAGES_PER_THREAD + 1));

      const read = (await PgChatStorage.read("t1"))!;
      expect(read[0]).toMatchObject({
        kind: "notice",
        id: truncationNoticeId("t1"),
      });
      expect(read[0]).toHaveProperty(
        "text",
        expect.stringMatching(/not kept/i)
      );
    });

    it("stays out of a thread that fits", async () => {
      await PgChatStorage.write("t1", many(MAX_MESSAGES_PER_THREAD));

      const read = (await PgChatStorage.read("t1"))!;
      expect(read.some((i) => i.kind === "notice")).toBe(false);
    });

    it("is not duplicated when a truncated thread is written back", async () => {
      await PgChatStorage.write("t1", many(MAX_MESSAGES_PER_THREAD + 10));
      const once = (await PgChatStorage.read("t1"))!;

      await PgChatStorage.write("t1", once);
      const twice = (await PgChatStorage.read("t1"))!;

      expect(twice.filter((i) => i.kind === "notice")).toHaveLength(1);
      expect(twice[0]).toMatchObject({ id: truncationNoticeId("t1") });
    });

    it("survives a rewrite whose remainder now fits", async () => {
      // The messages are still gone; only the count fits under the cap now
      await PgChatStorage.write("t1", many(MAX_MESSAGES_PER_THREAD + 10));
      const truncated = (await PgChatStorage.read("t1"))!;

      await PgChatStorage.write("t1", truncated);

      const read = (await PgChatStorage.read("t1"))!;
      expect(read[0]).toMatchObject({ id: truncationNoticeId("t1") });
    });

    it("goes away on a thread that never carried it", async () => {
      await PgChatStorage.write("t1", many(3));

      const read = (await PgChatStorage.read("t1"))!;
      expect(read.some((i) => i.kind === "notice")).toBe(false);
    });

    it("is local, so a thread on its way to the server never carries it", () => {
      // The server keeps every message; only this device drops the old ones
      const withNotice = [
        {
          kind: "notice" as const,
          id: truncationNoticeId("t1"),
          createdAt: "2026-01-01T00:00:00.000Z",
          text: "x",
        },
        item(1),
      ];

      expect(withoutTruncationNotice(withNotice)).toEqual([item(1)]);
    });
  });

  it("lists and removes threads", async () => {
    await PgChatStorage.write("t1", [item(1)]);
    await PgChatStorage.write("t2", [item(2)]);

    expect((await PgChatStorage.threadIds())!.sort()).toEqual(["t1", "t2"]);

    await PgChatStorage.remove("t1");

    expect(await PgChatStorage.threadIds()).toEqual(["t2"]);
    expect(await PgChatStorage.read("t1")).toEqual([]);
  });

  it("survives a hand-corrupted file rather than losing the panel", async () => {
    // Still does not throw -- the panel keeps working. It answers `null`
    // rather than `[]` so that callers which *delete* on "there is nothing
    // here" can tell the two apart; the panel itself renders either as empty.
    await PgChatStorage.write("t1", [item(1)]);
    mockFiles.set("/.config/chats/t1.json", "{ not json");

    await expect(PgChatStorage.read("t1")).resolves.toBeNull();
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

    it("answers null for a read that failed, rather than an empty thread", async () => {
      // The distinction the callers need: `[]` means "this conversation is
      // empty", `null` means "this device could not tell you". Sign-out
      // deletes local threads once they are safely uploaded, and the second
      // answer read as the first is how it deletes one it never uploaded.
      await PgChatStorage.write("t1", [item(1)]);
      mockFiles.set("/.config/chats/t1.json", "{ not json");

      expect(await PgChatStorage.read("t1")).toBeNull();
      expect(PgChatStorage.lastFailure?.what).toMatch(/read t1/);
    });

    it("answers null when the threads cannot be enumerated", async () => {
      const spy = vi
        .spyOn(PgFs, "readDir")
        .mockRejectedValueOnce(new Error("quota"));

      expect(await PgChatStorage.threadIds()).toBeNull();
      expect(PgChatStorage.lastFailure?.what).toMatch(/list threads/);
      spy.mockRestore();
    });

    it("still answers empty for a directory that is simply not there yet", async () => {
      // The ordinary state before the first message is ever written
      expect(await PgChatStorage.threadIds()).toEqual([]);
      expect(PgChatStorage.lastFailure).toBeNull();
    });

    it("records a write that failed", async () => {
      const spy = vi
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
    const spy = vi
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

    const [read] = (await PgChatStorage.read("t1"))!;
    if (read.kind !== "approval" || read.request.type !== "patch") {
      throw new Error("expected a stored patch approval");
    }
    // Trimmed to the changed region, and a pending card cannot be resumed so
    // it is stored as unanswered rather than left spinning
    expect(read.request.before!.length).toBeLessThan(big.length / 4);
    expect(read.status).toBe("unanswered");
  });
});
