// `public/` holds no robots.txt, so the build carries one only when `RobotsTxtPlugin` (`craco.config.js`) emitted it
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { robotsTxt } from "./robots.mjs";

const ROBOTS = path.join(import.meta.dirname, "..", "build", "robots.txt");

test("the build carries the robots.txt its environment asks for", async () => {
  assert.equal(
    await fs.readFile(ROBOTS, "utf8"),
    robotsTxt(process.env),
    `${ROBOTS} is not what scripts/robots.mjs gives for this environment; run the test with the build's VERCEL_ENV and DISALLOW_ROBOTS`
  );
});
