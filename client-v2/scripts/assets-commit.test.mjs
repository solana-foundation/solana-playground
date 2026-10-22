// `client-v2/Dockerfile` clones the assets at `assets-commit.txt`, since the
// image has no git data to read the submodule's commit from. This keeps the
// copy equal to the submodule entry.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { it } from "node:test";

const BUMP =
  "git ls-tree HEAD client/public | awk '{print $3}' > client-v2/scripts/assets-commit.txt";

it("assets-commit.txt names the commit the client/public submodule pins", (t) => {
  let entry;
  try {
    entry = execFileSync("git", ["ls-tree", "HEAD", "client/public"], {
      cwd: new URL("../..", import.meta.url),
      encoding: "utf8",
    }).trim();
  } catch (e) {
    return t.skip(`no git history to compare against: ${e.message}`);
  }
  if (!entry) return t.skip("HEAD has no client/public submodule entry");

  const [, type, pinned] = entry.split(/\s+/);
  assert.equal(type, "commit", `client/public is a ${type}, not a submodule`);
  const recorded = readFileSync(
    new URL("assets-commit.txt", import.meta.url),
    "utf8"
  ).trim();
  assert.equal(
    recorded,
    pinned,
    `client-v2/scripts/assets-commit.txt is stale; from the repository root run:\n  ${BUMP}`
  );
});
