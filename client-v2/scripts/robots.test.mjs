import assert from "node:assert/strict";
import { test } from "node:test";

import { DISALLOW_ROBOTS, isRobotsDisallowed } from "./robots.mjs";

test("keeps crawlers out when DISALLOW_ROBOTS=true", () => {
  assert.equal(isRobotsDisallowed({ [DISALLOW_ROBOTS]: "true" }), true);
});

test("leaves the site crawlable when DISALLOW_ROBOTS is unset", () => {
  assert.equal(isRobotsDisallowed({}), false);
});

test("leaves the site crawlable for a value other than true", () => {
  for (const value of ["", "1", "TRUE", "yes", "false"]) {
    assert.equal(isRobotsDisallowed({ [DISALLOW_ROBOTS]: value }), false);
  }
});
