import assert from "node:assert/strict";
import { test } from "node:test";

import { BRAND_HEAD, brandHead } from "./brand-head.mjs";

/** Upstream's `client/public/index.html` head, as mirrored */
const UPSTREAM = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%PUBLIC_URL%/favicon.ico" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#000000" />
    <meta
      name="description"
      content="Easily Build, Deploy and Test Solana Programs and smart contracts from a browser IDE."
    />
    <link rel="apple-touch-icon" href="%PUBLIC_URL%/logo192.png" />
    <link rel="manifest" href="%PUBLIC_URL%/manifest.json" />
    <title>Solana Playground | Solana IDE</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

const iconTags = (html) =>
  html.match(
    /<link[^>]*rel="(?:icon|apple-touch-icon)"[^>]*>|<meta[^>]*name="theme-color"[^>]*>/g
  ) ?? [];

test("upstream's icon links and theme colour give way to the brand's", () => {
  const html = brandHead(UPSTREAM);

  assert.deepEqual(iconTags(html), [
    '<link rel="icon" href="%PUBLIC_URL%/favicon.ico" sizes="32x32" />',
    '<link rel="icon" href="%PUBLIC_URL%/favicon.svg" type="image/svg+xml" />',
    '<link rel="icon" href="%PUBLIC_URL%/favicon-96x96.png" type="image/png" sizes="96x96" />',
    '<link rel="apple-touch-icon" href="%PUBLIC_URL%/apple-touch-icon.png" />',
    '<meta name="theme-color" content="#101011" />',
  ]);
  assert.doesNotMatch(html, /logo192|#000000/);
});

test("the brand block follows the charset, which stays first", () => {
  const html = brandHead(UPSTREAM);

  assert.ok(
    html.indexOf('<meta charset="utf-8" />') < html.indexOf(BRAND_HEAD[0])
  );
});

test("everything else in the head stays upstream's", () => {
  const html = brandHead(UPSTREAM);

  for (const kept of [
    "<title>Solana Playground | Solana IDE</title>",
    'name="description"',
    '<link rel="manifest" href="%PUBLIC_URL%/manifest.json" />',
    '<meta name="viewport"',
    '<div id="root"></div>',
  ]) {
    assert.ok(html.includes(kept), kept);
  }
});

test("a second run changes nothing", () => {
  const once = brandHead(UPSTREAM);

  assert.equal(brandHead(once), once);
});

test("upstream's icons go whatever their quoting, case or rel tokens", () => {
  const html = brandHead(
    UPSTREAM.replace(
      '<meta name="viewport"',
      "<LINK REL='shortcut icon' href='/old.ico'>\n    <meta name=\"viewport\""
    ).replace(/\n/g, "\r\n")
  );

  assert.doesNotMatch(html, /old\.ico|logo192|#000000/);
  assert.equal(iconTags(html).length, BRAND_HEAD.length);
});

test("a tag split over lines goes too", () => {
  const split = UPSTREAM.replace(
    '<meta name="theme-color" content="#000000" />',
    '<meta\n      name="theme-color"\n      content="#000000"\n    />'
  );

  assert.doesNotMatch(brandHead(split), /#000000/);
});

test("an icon tag the strip cannot remove fails instead of shipping beside ours", () => {
  const shared = UPSTREAM.replace(
    "<title>",
    '<link rel="icon" href="/old.png" /><title>'
  );

  assert.throws(
    () => brandHead(shared),
    /icon link or theme-color the rewrite did not remove/
  );
});

test("a page whose head it cannot place the block in fails loudly", () => {
  assert.throws(() => brandHead("<html><head></head></html>"), /meta charset/);
  assert.throws(() => brandHead('<meta charset="utf-8" />'), /<\/head>/);
});
