import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";

import {
  BRAND_HEAD,
  DESCRIPTION,
  IMAGE_ALT,
  SITE_URL,
  brandHead,
} from "./brand-head.mjs";

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
  assert.equal(iconTags(html).length, iconTags(BRAND_HEAD.join("")).length);
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

  assert.throws(() => brandHead(shared), /the rewrite did not remove/);
});

test("a page whose head it cannot place the block in fails loudly", () => {
  assert.throws(() => brandHead("<html><head></head></html>"), /meta charset/);
  assert.throws(() => brandHead('<meta charset="utf-8" />'), /<\/head>/);
});

// The spec's copy, spelled out here so an edit to the module's constants
// fails this test instead of silently changing the card
test("the card copy is the spec's", () => {
  assert.equal(
    DESCRIPTION,
    "Write, build and deploy Solana programs in your browser."
  );
  assert.equal(
    IMAGE_ALT,
    "Solana Playground logo on a dark background with the line: Write, build and deploy Solana programs in your browser."
  );
});

const ALT = IMAGE_ALT;

/** The share card the spec names, as `[attribute, key, content]` */
const CARD = [
  ["property", "og:type", "website"],
  ["property", "og:site_name", "Solana Playground"],
  ["property", "og:title", "Solana Playground"],
  ["property", "og:description", DESCRIPTION],
  ["property", "og:url", `${SITE_URL}/`],
  ["property", "og:image", `${SITE_URL}/og.png`],
  ["property", "og:image:type", "image/png"],
  ["property", "og:image:width", "1200"],
  ["property", "og:image:height", "630"],
  ["property", "og:image:alt", ALT],
  ["name", "twitter:card", "summary_large_image"],
  ["name", "twitter:title", "Solana Playground"],
  ["name", "twitter:description", DESCRIPTION],
  ["name", "twitter:image", `${SITE_URL}/og.png`],
  ["name", "twitter:image:alt", ALT],
];

const cardTags = (html) =>
  html.match(
    /<meta\b[^>]*(?:name|property)\s*=\s*["']?(?:og|twitter):[^>]*>/gi
  ) ?? [];

const contentOf = (html, key) =>
  html.match(new RegExp(`<meta [a-z]+="${key}" content="([^"]*)"`))?.[1];

test("the head carries the share card, each tag once", () => {
  const html = brandHead(UPSTREAM);

  assert.deepEqual(
    cardTags(html),
    CARD.map(
      ([attr, key, content]) => `<meta ${attr}="${key}" content="${content}" />`
    )
  );
});

test("every card URL is absolute, on the production base", () => {
  const html = brandHead(UPSTREAM);

  assert.match(SITE_URL, /^https:\/\/[^/]+$/);
  for (const key of ["og:url", "og:image", "twitter:image"]) {
    assert.ok(contentOf(html, key)?.startsWith(`${SITE_URL}/`), key);
  }
});

test("the card keeps upstream's title and description", () => {
  const html = brandHead(UPSTREAM);

  assert.ok(html.includes("<title>Solana Playground | Solana IDE</title>"));
  assert.ok(html.includes("Easily Build, Deploy and Test Solana Programs"));
});

test("upstream card tags go whatever their attribute, quoting, case or spacing", () => {
  const variants = [
    "<META PROPERTY='OG:IMAGE' content='/old.png'>",
    '<meta name="og:title" content="Old title" />',
    '<meta property="twitter:card" content="summary" />',
    '<meta property = "og:description" content="Old description" />',
    "<meta name=twitter:site content=@old>",
  ];
  const html = brandHead(
    UPSTREAM.replace(
      "<title>",
      `${variants.join("\n    ")}\n    <title>`
    ).replace(/\n/g, "\r\n")
  );

  assert.doesNotMatch(
    html,
    /old\.png|Old title|"summary"|Old description|@old/
  );
  assert.equal(cardTags(html).length, CARD.length);
});

test("an icon link spaced around its equals sign goes too", () => {
  const html = brandHead(
    UPSTREAM.replace(
      "<title>",
      '<link rel = "icon" href="/old.ico" />\n    <title>'
    )
  );

  assert.doesNotMatch(html, /old\.ico/);
});

test("a link whose other attributes mention icon stays", () => {
  const kept = "<link rel=stylesheet href=icon.css>";
  const html = brandHead(UPSTREAM.replace("<title>", `${kept}\n    <title>`));

  assert.ok(html.includes(kept));
});

test("an upstream card tag gives way to ours", () => {
  const html = brandHead(
    UPSTREAM.replace(
      "<title>",
      '<meta property="og:title" content="Old" />\n    <meta\n      name="twitter:card"\n      content="summary"\n    />\n    <title>'
    )
  );

  assert.doesNotMatch(html, /"Old"|"summary"/);
  assert.equal(cardTags(html).length, CARD.length);
});

test("an upstream card tag the strip cannot remove fails instead of shipping beside ours", () => {
  for (const tag of [
    '<meta name="twitter:card" content="summary" />',
    '<meta property="og:image" content="/old.png" />',
  ]) {
    assert.throws(
      () => brandHead(UPSTREAM.replace("<title>", `${tag}<title>`)),
      /did not remove/,
      tag
    );
  }
});

test("every brand tag is well formed, its values escaped", () => {
  for (const tag of BRAND_HEAD) {
    assert.match(tag, /^<(?:link|meta)(?: [a-z:-]+="[^"<>]*")+ \/>$/);
  }
});

test("the share image is a 1200x630 PNG in static/", async () => {
  const png = await fs.readFile(new URL("../static/og.png", import.meta.url));

  assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  // Unfurlers skip large images (X caps them at 5 MB); stay well under
  assert.ok(png.length < 1_000_000, `${png.length} bytes`);
});
