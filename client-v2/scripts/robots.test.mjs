import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DISALLOW_ALL,
  DISALLOW_ROBOTS,
  isRobotsDisallowed,
  robotsTxt,
} from "./robots.mjs";

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

test("keeps crawlers out of a preview without the flag", () => {
  assert.equal(isRobotsDisallowed({ VERCEL_ENV: "preview" }), true);
});

test("serves production an Allow that keeps crawlers out of the API", () => {
  assert.equal(
    robotsTxt({ VERCEL_ENV: "production" }),
    "User-agent: *\nAllow: /\nDisallow: /api/\n"
  );
});

test("serves a disallowed deployment DISALLOW_ALL", () => {
  assert.equal(DISALLOW_ALL, "User-agent: *\nDisallow: /\n");
  assert.equal(robotsTxt({ VERCEL_ENV: "preview" }), DISALLOW_ALL);
  assert.equal(
    robotsTxt({ VERCEL_ENV: "production", [DISALLOW_ROBOTS]: "true" }),
    DISALLOW_ALL
  );
});
