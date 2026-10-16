import { isUuid } from "../../../shared/lib/ids";

import { PgChatStorage } from "./chat-storage";
import { PgThreadIndex } from "./thread-index";
import { PgFs } from "../../../utils/explorer/fs";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

/** The mock's own store, for asserting on what is on disk */
const mockFiles = (PgFs as unknown as { __files: Map<string, string> }).__files;

const item = (n: number): ChatItem => ({
  kind: "user",
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  createdAt: new Date(n * 1000).toISOString(),
  text: `m${n}`,
});

const threadFiles = () =>
  [...mockFiles.keys()].filter(
    (path) => path.startsWith("/.config/chats/") && !path.endsWith("index.json")
  );

beforeEach(() => {
  mockFiles.clear();
  PgThreadIndex.reload();
});

afterEach(() => vi.restoreAllMocks());

describe("PgThreadIndex", () => {
  it("mints a thread for a workspace that has never had one", async () => {
    const id = await PgThreadIndex.ensure("w1");

    expect(isUuid(id)).toBe(true);
  });

  it("returns the same thread on every later call", async () => {
    const first = await PgThreadIndex.ensure("w1");

    expect(await PgThreadIndex.ensure("w1")).toBe(first);
    expect(await PgThreadIndex.get("w1")).toBe(first);
  });

  it("keeps workspaces apart", async () => {
    const one = await PgThreadIndex.ensure("w1");
    const two = await PgThreadIndex.ensure("w2");

    expect(one).not.toBe(two);
  });

  it("has nothing for a workspace it has not been asked about", async () => {
    expect(await PgThreadIndex.get("w1")).toBeNull();
  });

  it("names the workspace a thread belongs to", async () => {
    const id = await PgThreadIndex.ensure("tut:hello-anchor");

    expect(await PgThreadIndex.workspaceOf(id)).toBe("tut:hello-anchor");
  });

  it("has no workspace for a thread it does not know", async () => {
    expect(await PgThreadIndex.workspaceOf("nope")).toBeNull();
  });

  describe("forgetting a deleted workspace's conversation", () => {
    it("removes the thread and the entry that pointed at it", async () => {
      // A tutorial's id is derived from its name, so a restart reuses it: an
      // entry left behind reopened the previous run's conversation
      const threadId = await PgThreadIndex.ensure("tut:hello");
      await PgChatStorage.write(threadId, [item(1)]);

      await PgThreadIndex.forget("tut:hello");

      expect(await PgThreadIndex.get("tut:hello")).toBeNull();
      expect(await PgChatStorage.read(threadId)).toEqual([]);
      expect(threadFiles()).toEqual([]);
    });

    it("is still gone after the index is read again from storage", async () => {
      await PgThreadIndex.ensure("tut:hello");
      await PgThreadIndex.forget("tut:hello");

      PgThreadIndex.reload();
      expect(await PgThreadIndex.get("tut:hello")).toBeNull();
    });

    it("leaves other workspaces' conversations alone", async () => {
      await PgThreadIndex.ensure("tut:hello");
      const kept = await PgThreadIndex.ensure("w2");
      await PgChatStorage.write(kept, [item(2)]);

      await PgThreadIndex.forget("tut:hello");

      expect(await PgThreadIndex.get("w2")).toBe(kept);
      expect(await PgChatStorage.read(kept)).toEqual([item(2)]);
    });

    it("does nothing for a workspace that never had one", async () => {
      await expect(PgThreadIndex.forget("never")).resolves.toBe(true);
    });

    it("keeps the entry when the file could not be removed", async () => {
      // An entry dropped over a file that stayed left the file for the next
      // load's migration, which adopted it as a workspace named after the
      // thread
      const threadId = await PgThreadIndex.ensure("tut:hello");
      await PgChatStorage.write(threadId, [item(1)]);
      vi.spyOn(PgChatStorage, "remove").mockResolvedValue(false);

      await expect(PgThreadIndex.forget("tut:hello")).resolves.toBe(false);

      PgThreadIndex.reload();
      expect(await PgThreadIndex.get("tut:hello")).toBe(threadId);
    });

    it("keeps an entry another tab wrote while the file was being removed", async () => {
      // The map was read before the wait on storage and written back after
      // it, so whatever landed in between -- a neighbour tab's entry, or a
      // thread this tab minted -- was put back the way it was before
      await PgThreadIndex.ensure("tut:hello");
      vi.spyOn(PgChatStorage, "remove").mockImplementation(
        async (threadId: string) => {
          mockFiles.delete(`/.config/chats/${threadId}.json`);
          // Another tab, straight to storage, past this tab's cache
          const onDisk = JSON.parse(
            mockFiles.get("/.config/chats/index.json")!
          );
          mockFiles.set(
            "/.config/chats/index.json",
            JSON.stringify({
              "tut:hello": onDisk["tut:hello"],
              "next-door": item(7).id,
            })
          );
          return true;
        }
      );

      await PgThreadIndex.forget("tut:hello");

      expect(await PgThreadIndex.get("tut:hello")).toBeNull();
      expect(await PgThreadIndex.get("next-door")).toBe(item(7).id);
      PgThreadIndex.reload();
      expect(await PgThreadIndex.get("next-door")).toBe(item(7).id);
    });

    it("keeps a thread this tab minted while the file was being removed", async () => {
      await PgThreadIndex.ensure("tut:hello");
      let minted: string | null = null;
      vi.spyOn(PgChatStorage, "remove").mockImplementation(
        async (threadId: string) => {
          mockFiles.delete(`/.config/chats/${threadId}.json`);
          minted = PgThreadIndex.ensureSync("w2");
          return true;
        }
      );

      await PgThreadIndex.forget("tut:hello");

      expect(minted).not.toBeNull();
      expect(await PgThreadIndex.get("w2")).toBe(minted);
    });
  });

  describe("carrying a conversation to a new workspace", () => {
    // "Keep as a new project": the project was deleted on another device,
    // its conversation tombstoned with it, and the user keeps this device's
    // work under a new id -- chat included
    it("moves the items under a fresh thread id, and drops the old one", async () => {
      const old = await PgThreadIndex.ensure("p1");
      await PgChatStorage.write(old, [item(1), item(2)]);

      await PgThreadIndex.carry({ from: "p1", to: "p2" });

      const fresh = await PgThreadIndex.get("p2");
      expect(fresh).not.toBeNull();
      expect(fresh).not.toBe(old);
      expect(await PgThreadIndex.get("p1")).toBeNull();
      expect(await PgChatStorage.read(fresh!)).toEqual([item(1), item(2)]);
      expect(threadFiles()).toHaveLength(1);
    });

    it("does nothing when the workspace had no conversation", async () => {
      await PgThreadIndex.carry({ from: "p1", to: "p2" });

      expect(await PgThreadIndex.get("p2")).toBeNull();
    });

    it("carries an entry whose file was never written", async () => {
      // Minted, nothing said yet: an empty conversation, which the new
      // workspace gets as an entry of its own
      await PgThreadIndex.ensure("p1");

      await PgThreadIndex.carry({ from: "p1", to: "p2" });

      expect(await PgThreadIndex.get("p1")).toBeNull();
      expect(await PgThreadIndex.get("p2")).not.toBeNull();
    });

    it("carries a file it cannot read as it is, so nothing is lost", async () => {
      // And leaves no entry under the deleted id: a tutorial started again
      // under it would otherwise inherit this file
      const old = await PgThreadIndex.ensure("p1");
      mockFiles.set(`/.config/chats/${old}.json`, "{ not json");

      await PgThreadIndex.carry({ from: "p1", to: "p2" });

      const fresh = await PgThreadIndex.get("p2");
      expect(await PgThreadIndex.get("p1")).toBeNull();
      expect(mockFiles.get(`/.config/chats/${fresh}.json`)).toBe("{ not json");
      expect(threadFiles()).toHaveLength(1);
    });

    it("leaves everything as it was when the file cannot be moved", async () => {
      // "Keep as new" goes on to delete the original, whose delete forgets
      // the conversation: a carry that failed must say so
      const old = await PgThreadIndex.ensure("p1");
      await PgChatStorage.write(old, [item(1)]);
      vi.spyOn(PgFs, "rename").mockRejectedValue(new Error("QuotaExceeded"));

      await expect(PgThreadIndex.carry({ from: "p1", to: "p2" })).resolves.toBe(
        false
      );

      expect(await PgThreadIndex.get("p1")).toBe(old);
      expect(await PgThreadIndex.get("p2")).toBeNull();
      expect(await PgChatStorage.read(old)).toEqual([item(1)]);
    });

    it("puts the file back when the map cannot be written", async () => {
      // Left under its new name with no entry, the next load's migration
      // adopts it as a workspace named after the thread
      const old = await PgThreadIndex.ensure("p1");
      await PgChatStorage.write(old, [item(1)]);
      const write = PgFs.writeFile;
      vi.spyOn(PgFs, "writeFile").mockImplementation(
        async (path: string, ...rest) => {
          if (path.endsWith("index.json")) throw new Error("QuotaExceeded");
          return write(path, ...rest);
        }
      );

      await expect(PgThreadIndex.carry({ from: "p1", to: "p2" })).resolves.toBe(
        false
      );

      expect(await PgThreadIndex.get("p1")).toBe(old);
      expect(await PgThreadIndex.get("p2")).toBeNull();
      expect(threadFiles()).toEqual([`/.config/chats/${old}.json`]);
    });
  });

  describe("migrating a thread file named after its workspace", () => {
    /** What storage looked like before threads had ids of their own */
    const legacy = async (workspaceId: string, items: ChatItem[]) => {
      await PgChatStorage.write(workspaceId, items);
      // Written straight to storage, so the index has never heard of it
      PgThreadIndex.reload();
    };

    it("gives it an id and keeps the conversation", async () => {
      await legacy("tut:hello-anchor", [item(1), item(2)]);

      const id = await PgThreadIndex.ensure("tut:hello-anchor");

      expect(isUuid(id)).toBe(true);
      expect(await PgChatStorage.read(id)).toEqual([item(1), item(2)]);
    });

    it("leaves nothing behind under the old name", async () => {
      await legacy("w1", [item(1)]);

      await PgThreadIndex.ensure("w1");

      expect(threadFiles()).toHaveLength(1);
    });

    it("adopts nothing on the next load", async () => {
      await legacy("w1", [item(1)]);
      const id = await PgThreadIndex.ensure("w1");

      // A fresh load runs the pass again against the index it wrote; the file
      // it renamed must not be adopted a second time, under its own id
      PgThreadIndex.reload();

      expect(await PgThreadIndex.get("w1")).toBe(id);
      expect(Object.keys(await PgThreadIndex.all())).toEqual(["w1"]);
      expect(threadFiles()).toHaveLength(1);
    });

    it("migrates every workspace, not just the one being asked for", async () => {
      await PgChatStorage.write("w1", [item(1)]);
      await PgChatStorage.write("w2", [item(2)]);
      PgThreadIndex.reload();

      await PgThreadIndex.ensure("w1");

      expect(Object.keys(await PgThreadIndex.all()).sort()).toEqual([
        "w1",
        "w2",
      ]);
    });
  });

  it("survives an index a user has corrupted", async () => {
    mockFiles.set("/.config/chats/index.json", "{ not json");
    PgThreadIndex.reload();

    const id = await PgThreadIndex.ensure("w1");

    expect(isUuid(id)).toBe(true);
  });

  it("drops an index entry that is not a thread id", async () => {
    mockFiles.set(
      "/.config/chats/index.json",
      JSON.stringify({ w1: "not-a-uuid", w2: 7 })
    );
    PgThreadIndex.reload();

    expect(await PgThreadIndex.get("w1")).toBeNull();
    expect(await PgThreadIndex.get("w2")).toBeNull();
  });

  it("is not listed as a thread of its own", async () => {
    await PgThreadIndex.ensure("w1");
    await PgChatStorage.write(await PgThreadIndex.ensure("w1"), [item(1)]);

    expect(await PgChatStorage.threadIds()).not.toContain("index");
  });
});
