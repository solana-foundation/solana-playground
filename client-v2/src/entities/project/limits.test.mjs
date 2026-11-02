import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkFileWrite,
  checkProjectLimits,
  limitExceeded,
  PROJECT_LIMITS,
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
    ]) {
      assert.deepEqual(readLimitExceeded(limit), limit);
    }
  });

  it("keeps its figures", () => {
    assert.deepEqual(
      { ...PROJECT_LIMITS },
      {
        fileBytes: 131_072,
        pathChars: 256,
        projectBytes: 524_288,
        files: 50,
      }
    );
  });
});

describe("checkFileWrite", () => {
  it("refuses a file over its own limits whatever the project", () => {
    assert.equal(
      checkFileWrite({}, "src/a.rs", "a".repeat(131_073))?.reason,
      "file-too-large"
    );
    assert.equal(
      checkFileWrite({}, "p".repeat(257), "")?.reason,
      "path-too-long"
    );
  });

  it("counts a new path, not an overwrite", () => {
    const fifty = emptyFiles(50);
    assert.deepEqual(checkFileWrite(fifty, "src/new.rs", ""), {
      reason: "too-many-files",
      limit: 50,
      count: 51,
    });
    assert.equal(checkFileWrite(emptyFiles(60), "src/f1.rs", "x"), null);
    assert.equal(checkFileWrite(fifty, ".tutorial.json", "{}"), null);
  });

  it("refuses growing a project past the size limit, not shrinking it", () => {
    const files = {};
    for (let i = 0; i < 5; i++) files[`src/f${i}.rs`] = "a".repeat(110_000);
    assert.equal(
      checkFileWrite(files, "src/f0.rs", "a".repeat(110_001))?.reason,
      "project-too-large"
    );
    assert.equal(checkFileWrite(files, "src/f0.rs", "a".repeat(1_000)), null);
  });

  it("does not blame the write for another file over a limit", () => {
    const files = { "src/big.rs": "a".repeat(150_000) };
    assert.equal(checkFileWrite(files, "notes.md", ""), null);
  });

  it("ignores a path sync does not carry", () => {
    assert.equal(
      checkFileWrite(emptyFiles(50), ".workspace/metadata.json", "{}"),
      null
    );
  });
});
