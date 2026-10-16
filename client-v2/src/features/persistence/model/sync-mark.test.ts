import { PgSyncMark } from "./sync-mark";
import { PgSession } from "../../auth";
import { PgFs } from "../../../utils/explorer/fs";

const storedFiles = () =>
  (PgFs as unknown as { __files: Map<string, string> }).__files;

describe("PgSyncMark", () => {
  beforeEach(async () => {
    PgSession.reset();
    storedFiles().clear();
    await PgSession.refreshWith({
      id: "u1",
      name: null,
      image: null,
      login: null,
    });
  });

  it("round-trips per-file hashes", async () => {
    const mark = {
      files: { a: "h1" },
      name: "one",
      updatedAt: "t1",
      dirty: false,
    };
    await PgSyncMark.write("p1", mark);
    expect(await PgSyncMark.read("p1")).toEqual(mark);
  });

  it("reads a mark without per-file hashes as never agreed, yet as existing", async () => {
    // Unreadable as an agreement, but still the record that this device
    // synced the project -- the difference between "deleted elsewhere" and
    // "never uploaded"
    storedFiles().set(
      "/.config/sync/u1/p1.json",
      JSON.stringify({ name: "one", updatedAt: "t1", dirty: false })
    );
    expect(await PgSyncMark.read("p1")).toBeNull();
    expect(await PgSyncMark.exists("p1")).toBe(true);
    expect(await PgSyncMark.exists("p2")).toBe(false);
  });

  it("refuses a file map that is not strings", async () => {
    storedFiles().set(
      "/.config/sync/u1/p1.json",
      JSON.stringify({
        files: { a: 1 },
        name: "one",
        updatedAt: "t1",
        dirty: false,
      })
    );
    expect(await PgSyncMark.read("p1")).toBeNull();
  });

  describe("one project's writes, one at a time", () => {
    const old = {
      files: { a: "old" },
      name: "one",
      updatedAt: "t1",
      dirty: false,
    };
    const fresh = { ...old, files: { a: "new" }, updatedAt: "t2" };

    it("does not put back the mark a push replaced while flagging it dirty", async () => {
      // `markDirty` reads the mark and writes it back flagged. A push that
      // wrote its accepted mark in between was undone by it: the old mark
      // came back, and the next push was judged against an agreement the
      // server had already moved past -- a prompt about nothing.
      await PgSyncMark.write("p1", old);

      const flagging = PgSyncMark.markDirty("p1");
      const pushed = PgSyncMark.write("p1", fresh);
      await Promise.all([flagging, pushed]);

      expect(await PgSyncMark.read("p1")).toEqual(fresh);
    });

    it("flags the mark a push wrote, when the flag comes after it", async () => {
      await PgSyncMark.write("p1", old);

      const pushed = PgSyncMark.write("p1", fresh);
      const flagging = PgSyncMark.markDirty("p1");
      await Promise.all([pushed, flagging]);

      expect(await PgSyncMark.read("p1")).toEqual({ ...fresh, dirty: true });
    });

    it("does not bring back a removed mark", async () => {
      await PgSyncMark.write("p1", old);

      const flagging = PgSyncMark.markDirty("p1");
      const removing = PgSyncMark.remove("p1");
      await Promise.all([flagging, removing]);

      expect(await PgSyncMark.exists("p1")).toBe(false);
    });

    it("keeps going after a write that failed", async () => {
      const writeFile = vi
        .spyOn(PgFs, "writeFile")
        .mockRejectedValueOnce(new Error("quota"));
      await PgSyncMark.write("p1", old);
      writeFile.mockRestore();

      await PgSyncMark.write("p1", fresh);
      expect(await PgSyncMark.read("p1")).toEqual(fresh);
    });
  });
});
