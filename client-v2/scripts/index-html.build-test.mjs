// `craco.config.js` fills `%SITE_URL%` in `public/index.html`, so only the built page shows whether it did
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { resolveSiteUrl, SITE_URL_PLACEHOLDER } from "./site-url.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const template = await fs.readFile(
  path.join(ROOT, "public", "index.html"),
  "utf8"
);
const page = await fs.readFile(path.join(ROOT, "build", "index.html"), "utf8");
const origin = resolveSiteUrl(process.env);

const count = (text, fragment) => text.split(fragment).length - 1;

test(`the built page has no ${SITE_URL_PLACEHOLDER} left`, () => {
  assert.equal(count(page, SITE_URL_PLACEHOLDER), 0);
});

test(`each ${SITE_URL_PLACEHOLDER} became the origin the build's environment resolves`, () => {
  assert.equal(
    count(page, origin),
    count(template, SITE_URL_PLACEHOLDER),
    `run the test with the build's SITE_URL and VERCEL_PROJECT_PRODUCTION_URL`
  );
});
