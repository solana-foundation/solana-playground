// `craco.config.js` fills `%SITE_URL%` in `public/index.html`, so only the built page shows whether it did
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { resolveSiteUrl, SITE_URL_PLACEHOLDER } from "./site-url.mjs";

const PAGE = path.join(import.meta.dirname, "..", "build", "index.html");

const page = await fs.readFile(PAGE, "utf8");

for (const tag of [
  '<link rel="icon" href="/favicon.ico" sizes="32x32"/>',
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>',
  '<link rel="icon" href="/favicon-96x96.png" type="image/png" sizes="96x96"/>',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png"/>',
]) {
  test(`the built page carries ${tag}`, () => {
    assert.ok(page.includes(tag), `${PAGE} lacks ${tag}`);
  });
}

test("the built page's og:image is on the origin its environment resolves", () => {
  const tag = `<meta property="og:image" content="${resolveSiteUrl(
    process.env
  )}/og.png"/>`;
  assert.ok(
    page.includes(tag),
    `${PAGE} lacks ${tag}; run the test with the build's SITE_URL and VERCEL_PROJECT_PRODUCTION_URL`
  );
});

test(`the built page has no ${SITE_URL_PLACEHOLDER} left`, () => {
  assert.ok(!page.includes(SITE_URL_PLACEHOLDER));
});
