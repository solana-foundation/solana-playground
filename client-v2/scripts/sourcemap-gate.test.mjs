import assert from "node:assert/strict";
import { test } from "node:test";

import { sourcemapsEnabled } from "./sourcemap-gate.mjs";

for (const [label, env, expected] of [
  ["emits in production", { VERCEL_ENV: "production" }, true],
  ["stays off in preview by default", { VERCEL_ENV: "preview" }, false],
  [
    "emits in preview when enabled",
    { VERCEL_ENV: "preview", SOURCEMAPS_PREVIEW_ENABLED: "true" },
    true,
  ],
  [
    "needs the exact string true",
    { VERCEL_ENV: "preview", SOURCEMAPS_PREVIEW_ENABLED: "1" },
    false,
  ],
  [
    "enables preview only, not development",
    { VERCEL_ENV: "development", SOURCEMAPS_PREVIEW_ENABLED: "true" },
    false,
  ],
  ["stays off outside Vercel", { SOURCEMAPS_PREVIEW_ENABLED: "true" }, false],
]) {
  test(`sourcemapsEnabled ${label}`, () => {
    assert.equal(sourcemapsEnabled(env), expected);
  });
}
