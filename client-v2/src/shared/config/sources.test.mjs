import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SOURCES_CATALOGUE } from "./sources.mjs";

/** A raw.githubusercontent.com folder at a full commit hash, never a branch */
const PINNED =
  /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//;

const community = SOURCES_CATALOGUE.filter((entry) => entry.community);

describe("SOURCES_CATALOGUE community skills", () => {
  test("A community skill is pinned to a commit", () => {
    const unpinned = community
      .filter(
        (entry) =>
          entry.source?.type !== "remote" || !PINNED.test(entry.source.baseUrl)
      )
      .map((entry) => entry.id);

    assert.ok(community.length > 0);
    assert.deepEqual(unpinned, []);
  });

  test("Every caller gets the community skills, switched off", () => {
    const misplaced = community
      .filter(
        (entry) => entry.enabled !== false || entry.signedIn !== undefined
      )
      .map((entry) => entry.id);

    assert.deepEqual(misplaced, []);
  });
});
