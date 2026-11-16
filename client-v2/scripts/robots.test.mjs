import assert from "node:assert/strict";
import { test } from "node:test";

import { DISALLOW_ROBOTS, isRobotsDisallowed } from "./robots.mjs";

test("DISALLOW_ROBOTS=true keeps crawlers out", () => {
  assert.equal(isRobotsDisallowed({ [DISALLOW_ROBOTS]: "true" }), true);
});

test("an unset DISALLOW_ROBOTS leaves the site crawlable", () => {
  assert.equal(isRobotsDisallowed({}), false);
});

test("a value other than true leaves the site crawlable", () => {
  for (const value of ["", "1", "TRUE", "yes", "false"]) {
    assert.equal(isRobotsDisallowed({ [DISALLOW_ROBOTS]: value }), false);
  }
});
