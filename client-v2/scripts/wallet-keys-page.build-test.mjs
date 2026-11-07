// On the key host vercel.json redirects every path but the key page's own to that page, so a file it loads outside them arrives as HTML
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const CLIENT = path.join(import.meta.dirname, "..");
const BUILD = path.join(CLIENT, "build");

/** Whether the key host's redirect sends `urlPath` to the key page, read as Vercel reads a raw source */
const redirectedOnKeyHost = async (urlPath) => {
  const vercel = JSON.parse(
    await fs.readFile(path.join(CLIENT, "vercel.json"), "utf8")
  );
  const rule = vercel.redirects.find(
    (r) => r.destination === "/wallet-keys.html"
  );
  assert.ok(rule, "vercel.json has no redirect to /wallet-keys.html");
  return new RegExp(`^${rule.source}$`).test(urlPath);
};

/** The `src` and `href` of every script and stylesheet the page loads */
const loadedBy = (html) =>
  Array.from(
    html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g),
    ([, url]) => url
  );

test("the key page loads only files the key host serves", async () => {
  const html = await fs.readFile(path.join(BUILD, "wallet-keys.html"), "utf8");
  const urls = loadedBy(html);
  assert.notEqual(urls.length, 0, "wallet-keys.html loads no script");

  const redirected = [];
  for (const url of urls) {
    if (await redirectedOnKeyHost(url)) redirected.push(url);
  }
  assert.deepEqual(
    redirected,
    [],
    "the key host serves these as wallet-keys.html: keep the key entry in one file (craco.config.js PAGES)"
  );

  // A chunk loader would fetch `static/js/<id>.chunk.js` at run time, which the redirect also catches
  for (const url of urls.filter((u) => u.endsWith(".js"))) {
    const js = await fs.readFile(path.join(BUILD, url), "utf8");
    assert.ok(
      !js.includes(".chunk.js"),
      `${url} loads chunks at run time; the key host would serve them as HTML`
    );
  }
});
