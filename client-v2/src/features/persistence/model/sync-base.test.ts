import { PgSyncBase } from "./sync-base";
import { PgSyncMark } from "./sync-mark";
import { sha256 } from "./snapshot";
import { PgSession } from "../../auth";
import { PgFs } from "../../../utils/explorer/fs";

const storedFiles = () =>
  (PgFs as unknown as { __files: Map<string, string> }).__files;

const signedIn = () =>
  PgSession.refreshWith({ id: "u1", name: null, image: null, login: null });

describe("PgSyncBase", () => {
  beforeEach(async () => {
    PgSession.reset();
    PgSyncBase.reset();
    storedFiles().clear();
    await signedIn();
  });

  it("keeps a file's pre-edit content, taken from the shadow", async () => {
    PgSyncBase.track("p1", { "src/lib.rs": "before" });
    await PgSyncBase.capture("p1", ["src/lib.rs"], {
      "src/lib.rs": await sha256("before"),
    });
    expect(await PgSyncBase.read("p1")).toEqual({
      "src/lib.rs": { hash: await sha256("before"), content: "before" },
    });
  });

  it("does not take a shadow that is already past the agreement", async () => {
    // Opened after a reload with unpushed edits: the shadow holds the edit,
    // not the base, and keeping it would make a later merge wrong
    PgSyncBase.track("p1", { "src/lib.rs": "already edited" });
    await PgSyncBase.capture("p1", ["src/lib.rs"], {
      "src/lib.rs": await sha256("before"),
    });
    expect(await PgSyncBase.read("p1")).toEqual({});
  });

  it("takes the agreed content from the caller when it has it, and still checks it", async () => {
    // Sync folding typing into a file it rewrote: the shadow has already been
    // re-taken from the folded copy, and the caller holds the agreed one
    PgSyncBase.track("p1", { f: "agreed plus typing", g: "other" });
    const hashes = { f: await sha256("agreed"), g: await sha256("g agreed") };
    await PgSyncBase.capture("p1", ["f", "g"], hashes, {
      f: "agreed",
      g: "not what the mark says",
    });
    expect(await PgSyncBase.read("p1")).toEqual({
      f: { hash: hashes.f, content: "agreed" },
    });
  });

  it("keeps the first capture, not a later one", async () => {
    const hash = await sha256("before");
    PgSyncBase.track("p1", { f: "before" });
    await PgSyncBase.capture("p1", ["f"], { f: hash });
    PgSyncBase.track("p1", { f: "edited once" });
    await PgSyncBase.capture("p1", ["f"], { f: hash });
    expect((await PgSyncBase.read("p1")).f.content).toBe("before");
  });

  it("captures nothing for another project, or for generated files", async () => {
    const keypair = ".workspace/program-info.json";
    PgSyncBase.track("p1", { f: "x", [keypair]: "k" });
    await PgSyncBase.capture("p2", ["f"], { f: await sha256("x") });
    await PgSyncBase.capture("p1", [keypair], { [keypair]: await sha256("k") });
    expect(await PgSyncBase.read("p1")).toEqual({});
    expect(await PgSyncBase.read("p2")).toEqual({});
  });

  it("starts again from an accepted upload", async () => {
    PgSyncBase.track("p1", { f: "before" });
    await PgSyncBase.capture("p1", ["f"], { f: await sha256("before") });
    await PgSyncBase.accepted("p1", { files: { f: "after" } }, true);

    expect(await PgSyncBase.read("p1")).toEqual({});
    // ...and the accepted copy is now what an edit is measured from
    await PgSyncBase.capture("p1", ["f"], { f: await sha256("after") });
    expect((await PgSyncBase.read("p1")).f.content).toBe("after");
  });

  it("is invisible to the sync marks' own listing", async () => {
    // A base file listed as a mark would read as a project deleted elsewhere
    PgSyncBase.track("tut:hello", { f: "x" });
    await PgSyncBase.capture("tut:hello", ["f"], { f: await sha256("x") });
    expect(await PgSyncMark.projectIds()).toEqual([]);
    expect(await PgSyncBase.read("tut:hello")).not.toEqual({});
  });

  it("reads a corrupt file as empty, and says so", async () => {
    storedFiles().set("/.config/sync-base/u1/p1.json", "{not json");
    expect(await PgSyncBase.read("p1")).toEqual({});
  });
});
