// The curated gallery (`public/programs/programs.json`), checked against the
// rules in `client-v2/README.md` ("The program gallery") that a file can show:
// whether a program builds is checked by hand, as the README says.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const LIST_URL = new URL("../public/programs/programs.json", import.meta.url);
const programs = JSON.parse(fs.readFileSync(LIST_URL, "utf8"));

/** The fields `entities/program` (`isListing`) refuses an entry without */
const STRING_FIELDS = ["name", "description", "repo", "icon", "framework"];

/** A folder at a named ref, as `PgGithub.parseUrl` reads it */
const PINNED_REPO =
  /^https:\/\/github\.com\/[\w-]+\/[\w-]+\/tree\/[\w-.]+\/[\w-/.]+$/;

test("the list is not empty", () => {
  assert.ok(Array.isArray(programs) && programs.length > 0);
});

test("every entry carries the fields the gallery reads", () => {
  for (const p of programs) {
    for (const field of STRING_FIELDS) {
      assert.equal(typeof p[field], "string", `${p.name}: ${field}`);
      assert.notEqual(p[field], "", `${p.name}: ${field}`);
    }
    assert.ok(
      Array.isArray(p.categories) &&
        p.categories.length > 0 &&
        p.categories.every((c) => typeof c === "string" && c !== ""),
      `${p.name}: categories`
    );
  }
});

test("every repo names a ref and a folder", () => {
  for (const p of programs) {
    assert.match(p.repo, PINNED_REPO, p.name);
  }
});

test("names and repos are unique", () => {
  const names = programs.map((p) => p.name);
  const repos = programs.map((p) => p.repo);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(repos).size, repos.length);
});
