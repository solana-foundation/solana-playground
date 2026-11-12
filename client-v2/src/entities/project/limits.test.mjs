import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkProjectLimits,
  checkWriteTo,
  limitExceeded,
  readLimitExceeded,
  SYNCED_WORKSPACE_FILES,
} from "./limits.mjs";

/** `count` empty user files, `src/f0.rs` onward */
const emptyFiles = (count) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`src/f${i}.rs`, ""])
  );

/** The three generated files, empty */
const generated = () =>
  Object.fromEntries(SYNCED_WORKSPACE_FILES.map((path) => [path, ""]));

describe("entities/project/limits", () => {
  it("passes an empty project", () => {
    assert.equal(checkProjectLimits({}), null);
  });

  describe("file size", () => {
    it("passes a file at the limit", () => {
      assert.equal(
        checkProjectLimits({ "src/lib.rs": "a".repeat(131_072) }),
        null
      );
    });

    it("stops a file one byte over", () => {
      assert.deepEqual(
        checkProjectLimits({ "src/lib.rs": "a".repeat(131_073) }),
        {
          reason: "file-too-large",
          limit: 131_072,
          paths: ["src/lib.rs"],
          sizes: { "src/lib.rs": 131_073 },
        }
      );
    });

    it("counts multi-byte characters as bytes", () => {
      // "€" is three bytes in UTF-8
      const result = checkProjectLimits({ "src/lib.rs": "€".repeat(50_000) });
      assert.equal(result?.reason, "file-too-large");
      assert.equal(result?.sizes["src/lib.rs"], 150_000);
    });

    it("names every file over, sorted", () => {
      const big = "a".repeat(131_073);
      assert.deepEqual(
        checkProjectLimits({ "src/b.rs": big, "src/a.rs": big, "ok.rs": "" })
          ?.paths,
        ["src/a.rs", "src/b.rs"]
      );
    });

    it("stops a file named __proto__", () => {
      // A request body parses `__proto__` as an own key, which a plain
      // object's setter would swallow
      const files = JSON.parse(
        JSON.stringify({ x: "a".repeat(131_073) }).replace('"x"', '"__proto__"')
      );
      assert.deepEqual(checkProjectLimits(files)?.paths, ["__proto__"]);
    });
  });

  describe("path length", () => {
    it("passes a path of 256 code points", () => {
      assert.equal(checkProjectLimits({ ["p".repeat(256)]: "" }), null);
    });

    it("stops a path of 257 code points", () => {
      const path = "p".repeat(257);
      assert.deepEqual(checkProjectLimits({ [path]: "" }), {
        reason: "path-too-long",
        limit: 256,
        paths: [path],
      });
    });

    it("measures code points, not UTF-16 units", () => {
      // An emoji is two UTF-16 units and one code point
      assert.equal(checkProjectLimits({ ["😀".repeat(256)]: "" }), null);
    });
  });

  describe("file count", () => {
    it("passes 50 files with the three generated files beside them", () => {
      const files = Object.assign(emptyFiles(50), generated());
      assert.equal(checkProjectLimits(files), null);
    });

    it("stops 51 empty files", () => {
      assert.deepEqual(checkProjectLimits(emptyFiles(51)), {
        reason: "too-many-files",
        limit: 50,
        count: 51,
      });
    });
  });

  describe("project size", () => {
    const kib100 = "a".repeat(102_400);

    it("passes five files of 100 KiB", () => {
      const files = Object.fromEntries(
        [0, 1, 2, 3, 4].map((i) => [`src/f${i}.rs`, kib100])
      );
      assert.equal(checkProjectLimits(files), null);
    });

    it("stops them once a sixth of 13,000 bytes joins", () => {
      const files = Object.fromEntries(
        [0, 1, 2, 3, 4].map((i) => [`src/f${i}.rs`, kib100])
      );
      files["src/f5.rs"] = "a".repeat(13_000);
      assert.deepEqual(checkProjectLimits(files), {
        reason: "project-too-large",
        limit: 524_288,
        size: 525_000,
      });
    });

    it("counts the generated files toward the size", () => {
      // 4 x 131,047 + 100 is the limit exactly; one more byte is over it
      const files = { ".workspace/program-info.json": "a".repeat(100) };
      for (let i = 0; i < 4; i++) files[`src/f${i}.rs`] = "a".repeat(131_047);
      assert.equal(checkProjectLimits(files), null);
      files[".workspace/program-info.json"] = "a".repeat(101);
      assert.equal(checkProjectLimits(files)?.reason, "project-too-large");
    });
  });

  it("leaves .workspace/metadata.json out of every measure", () => {
    const files = emptyFiles(50);
    files[".workspace/metadata.json"] = "a".repeat(600_000);
    files[`.workspace/${"m".repeat(300)}`] = "";
    assert.equal(checkProjectLimits(files), null);
  });

  it("checks path, file size, file count, then project size", () => {
    const big = "a".repeat(131_073);
    const longPath = "p".repeat(257);

    const all = emptyFiles(60);
    for (let i = 0; i < 5; i++) all[`src/big${i}.rs`] = big;
    all[longPath] = "";
    assert.equal(checkProjectLimits(all)?.reason, "path-too-long");

    delete all[longPath];
    assert.equal(checkProjectLimits(all)?.reason, "file-too-large");

    for (let i = 0; i < 5; i++) all[`src/big${i}.rs`] = "a".repeat(120_000);
    assert.equal(checkProjectLimits(all)?.reason, "too-many-files");

    const sized = {};
    for (let i = 0; i < 5; i++) sized[`src/big${i}.rs`] = "a".repeat(120_000);
    assert.equal(checkProjectLimits(sized)?.reason, "project-too-large");
  });

  it("reads a limit body, not the body cap's", () => {
    assert.deepEqual(
      readLimitExceeded({ reason: "too-many-files", limit: 50, count: 51 }),
      { reason: "too-many-files", limit: 50, count: 51 }
    );
    assert.equal(readLimitExceeded({ reason: "too-large" }), null);
    assert.equal(
      readLimitExceeded({ reason: "too-many-lines", limit: 1, size: 2 }),
      // eslint-disable-next-line unicorn/no-null -- `readLimitExceeded`'s answer for "not a limit body"
      null
    );
    assert.equal(readLimitExceeded(null), null);
  });

  it("refuses a limit body missing what its reason needs", () => {
    for (const body of [
      { reason: "path-too-long", limit: 256 },
      { reason: "path-too-long", limit: 256, paths: [] },
      { reason: "file-too-large", limit: 131072, paths: ["a.rs"] },
      { reason: "file-too-large", limit: 131072, paths: ["a.rs"], sizes: {} },
      { reason: "too-many-files", limit: 50 },
      { reason: "too-many-files", limit: 50, count: "51" },
      { reason: "project-too-large", limit: 524288 },
      { reason: "project-too-large", size: 600000 },
      { reason: "too-many-projects", limit: 10, count: 11 },
      { reason: "too-many-projects", kind: "repo", limit: 10, count: 11 },
      { reason: "too-many-projects", kind: "project", limit: 10 },
    ]) {
      assert.equal(readLimitExceeded(body), null, JSON.stringify(body));
    }
  });

  it("copies only the fields a limit body's reason has", () => {
    assert.deepEqual(
      readLimitExceeded({
        error: "The project is over a sync limit",
        reason: "file-too-large",
        limit: 131072,
        paths: ["a.rs"],
        sizes: { "a.rs": 140000, "b.rs": 1 },
        count: 3,
      }),
      {
        reason: "file-too-large",
        limit: 131072,
        paths: ["a.rs"],
        sizes: { "a.rs": 140000 },
      }
    );
  });

  it("reads back every shape it builds", () => {
    for (const limit of [
      limitExceeded.pathTooLong(["b", "a"]),
      limitExceeded.fileTooLarge({ "a.rs": 140000 }),
      limitExceeded.tooManyFiles(51),
      limitExceeded.projectTooLarge(600000),
      limitExceeded.tooManyProjects("project", 11),
      limitExceeded.tooManyProjects("tutorial", 33),
    ]) {
      assert.deepEqual(readLimitExceeded(limit), limit);
    }
  });

  it("builds and reads one limit in the same key order", () => {
    // `sameQuestion` compares limits as JSON, so the client's check and a
    // 413 must spell one limit identically
    const built = limitExceeded.fileTooLarge({
      "b.rs": 140001,
      "a.rs": 140000,
    });
    const read = readLimitExceeded({
      reason: "file-too-large",
      limit: built.limit,
      paths: ["b.rs", "a.rs"],
      sizes: { "a.rs": 140000, "b.rs": 140001 },
    });
    assert.equal(JSON.stringify(read), JSON.stringify(built));
    assert.deepEqual(built.paths, ["a.rs", "b.rs"]);
    assert.deepEqual(Object.keys(built.sizes), ["a.rs", "b.rs"]);
  });

  it("caps each kind at its own figure", () => {
    assert.deepEqual(limitExceeded.tooManyProjects("project", 11), {
      reason: "too-many-projects",
      kind: "project",
      limit: 10,
      count: 11,
    });
    assert.equal(limitExceeded.tooManyProjects("tutorial", 33).limit, 32);
  });
});

describe("checkWriteTo", () => {
  it("refuses a file over its own limits whatever the project", () => {
    assert.equal(
      checkWriteTo({})("src/a.rs")("a".repeat(131_073))?.reason,
      "file-too-large"
    );
    assert.equal(
      checkWriteTo({})("p".repeat(257))("")?.reason,
      "path-too-long"
    );
  });

  it("refuses a new path past the count limit, not an overwrite under it", () => {
    const fifty = emptyFiles(50);
    assert.deepEqual(checkWriteTo(fifty)("src/new.rs")(""), {
      reason: "too-many-files",
      limit: 50,
      count: 51,
    });
    assert.equal(checkWriteTo(fifty)("src/f1.rs")("x"), null);
    assert.equal(checkWriteTo(fifty)(".tutorial.json")("{}"), null);
  });

  it("refuses an overwrite in a project still over the count limit", () => {
    assert.deepEqual(checkWriteTo(emptyFiles(60))("src/f1.rs")("x"), {
      reason: "too-many-files",
      limit: 50,
      count: 60,
    });
  });

  it("refuses a shrink that leaves the project over the size limit", () => {
    const files = {};
    for (let i = 0; i < 5; i++) files[`src/f${i}.rs`] = "a".repeat(110_000);
    // 550,000 bytes: growing, and shrinking by too little, are both refused
    assert.equal(
      checkWriteTo(files)("src/f0.rs")("a".repeat(110_001))?.reason,
      "project-too-large"
    );
    assert.deepEqual(checkWriteTo(files)("src/f0.rs")("a".repeat(90_000)), {
      reason: "project-too-large",
      limit: 524_288,
      size: 530_000,
    });
    // 441,000 bytes: back under
    assert.equal(checkWriteTo(files)("src/f0.rs")("a".repeat(1_000)), null);
  });

  it("refuses a shrink that leaves the file over the size limit", () => {
    const files = { "src/big.rs": "a".repeat(200_000) };
    assert.equal(
      checkWriteTo(files)("src/big.rs")("a".repeat(150_000))?.reason,
      "file-too-large"
    );
    assert.equal(checkWriteTo(files)("src/big.rs")("a".repeat(131_072)), null);
  });

  it("does not blame the write for another file over a limit", () => {
    const files = { "src/big.rs": "a".repeat(150_000) };
    assert.equal(checkWriteTo(files)("notes.md")(""), null);
  });

  it("ignores a path sync does not carry", () => {
    assert.equal(
      checkWriteTo(emptyFiles(50))(".workspace/metadata.json")("{}"),
      null
    );
  });
});
