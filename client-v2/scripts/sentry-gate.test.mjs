import assert from "node:assert/strict";
import { test } from "node:test";

import { sentryEnabled } from "./sentry-gate.mjs";

const DSN = "https://key@o0.ingest.sentry.io/0";

for (const [label, env, expected] of [
  [
    "reports from production",
    { REACT_APP_SENTRY_DSN: DSN, VERCEL_ENV: "production" },
    true,
  ],
  [
    "stays off in preview by default",
    { REACT_APP_SENTRY_DSN: DSN, VERCEL_ENV: "preview" },
    false,
  ],
  [
    "reports from preview when enabled",
    {
      REACT_APP_SENTRY_DSN: DSN,
      VERCEL_ENV: "preview",
      SENTRY_PREVIEW_ENABLED: "true",
    },
    true,
  ],
  [
    "needs the exact string true",
    {
      REACT_APP_SENTRY_DSN: DSN,
      VERCEL_ENV: "preview",
      SENTRY_PREVIEW_ENABLED: "1",
    },
    false,
  ],
  [
    "enables preview only, not development",
    {
      REACT_APP_SENTRY_DSN: DSN,
      VERCEL_ENV: "development",
      SENTRY_PREVIEW_ENABLED: "true",
    },
    false,
  ],
  ["stays off outside Vercel", { REACT_APP_SENTRY_DSN: DSN }, false],
  ["needs a DSN even in production", { VERCEL_ENV: "production" }, false],
]) {
  test(`sentryEnabled ${label}`, () => {
    assert.equal(sentryEnabled(env), expected);
  });
}
