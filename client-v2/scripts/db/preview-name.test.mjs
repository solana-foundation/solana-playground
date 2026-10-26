import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BRANCH_PREFIX,
  branchDatabaseName,
  nameFromArgs,
  prDatabaseName,
} from "./preview-name.mjs";

const HASHED = /_[0-9a-f]{8}$/;

describe("preview-name", () => {
  it("names a PR's database by its number", () => {
    assert.equal(prDatabaseName(42), "solpg_preview_pr_42");
    assert.equal(nameFromArgs(["--pr", "42"]), "solpg_preview_pr_42");
    // A number only: anything else could smuggle in another name
    for (const bad of ["", "0", "042", "42; drop", "solpg", "-1"]) {
      assert.throws(() => prDatabaseName(bad), /not a pull request number/);
    }
  });

  it("cuts a long branch and appends a hash", () => {
    const stem = "feature/".padEnd(69, "x");
    const a = branchDatabaseName(`${stem}a`);
    const b = branchDatabaseName(`${stem}b`);
    assert.equal(`${stem}a`.length, 70);
    for (const name of [a, b]) {
      assert.ok(Buffer.byteLength(name) <= 63, `${name} is too long`);
      assert.ok(name.startsWith(BRANCH_PREFIX));
      assert.match(name, HASHED);
      assert.match(name, /^[a-z0-9_]+$/);
    }
    // The two differ only past the cut, so only the hash tells them apart
    assert.notEqual(a, b);
  });

  it("keeps branches that sanitise alike apart", () => {
    const dash = branchDatabaseName("fix/a-b");
    const underscore = branchDatabaseName("fix/a_b");
    assert.notEqual(dash, underscore);
    for (const name of [dash, underscore]) {
      assert.ok(!name.includes("-"));
      assert.ok(name.startsWith("solpg_preview_br_fix_a_b_"));
    }
  });

  it("keeps a branch apart from the PR it is named like", () => {
    const name = nameFromArgs(["--branch", "pr_42"]);
    assert.notEqual(name, prDatabaseName(42));
    assert.ok(name.startsWith(BRANCH_PREFIX));
  });
});
