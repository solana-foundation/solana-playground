import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveSiteUrl } from "./site-url.mjs";

for (const [title, env, expected] of [
  [
    "SITE_URL wins over Vercel's domain",
    { SITE_URL: "https://a.test", VERCEL_PROJECT_PRODUCTION_URL: "b.test" },
    "https://a.test",
  ],
  [
    "an empty SITE_URL gives way to Vercel's domain, over https",
    { SITE_URL: "", VERCEL_PROJECT_PRODUCTION_URL: "b.vercel.app" },
    "https://b.vercel.app",
  ],
  ["neither gives the production site", {}, "https://playground.solana.com"],
  [
    "a trailing slash is dropped",
    { SITE_URL: "https://a.test/" },
    "https://a.test",
  ],
]) {
  test(`resolveSiteUrl: ${title}`, () => {
    assert.equal(resolveSiteUrl(env), expected);
  });
}

for (const [title, value] of [
  ["a host without a scheme", "example.test"],
  ["a URL with a path", "https://a.test/app"],
  ["a scheme other than http(s)", "ftp://a.test"],
]) {
  test(`resolveSiteUrl refuses ${title}, naming SITE_URL`, () => {
    assert.throws(() => resolveSiteUrl({ SITE_URL: value }), /SITE_URL/);
  });
}
