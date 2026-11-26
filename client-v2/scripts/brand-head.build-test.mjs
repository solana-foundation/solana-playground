// `public/index.html` is upstream's, so the build carries the brand head only when `craco.config.js` handed HtmlWebpackPlugin the branded page
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { brandTagsFor, resolveSiteUrl } from "./brand-head.mjs";

const PAGE = path.join(import.meta.dirname, "..", "build", "index.html");

/** A brand tag as the minified page writes it: `%PUBLIC_URL%` filled in, no space before `/>` */
const built = (tag) => tag.replaceAll("%PUBLIC_URL%", "").replace(" />", "/>");

test("the built page carries the brand head its environment asks for", async () => {
  const page = await fs.readFile(PAGE, "utf8");
  assert.ok(
    page.includes(
      brandTagsFor(resolveSiteUrl(process.env)).map(built).join("")
    ),
    `${PAGE} lacks the brand head scripts/brand-head.mjs gives for this environment; run the test with the build's SITE_URL and VERCEL_PROJECT_PRODUCTION_URL`
  );
});
