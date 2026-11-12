// The fork's `static/manifest.json`, which replaces upstream's in `public/`
// (client-v2-build: "The manifest").
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const STATIC = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../static"
);
const manifest = JSON.parse(
  await fs.readFile(path.join(STATIC, "manifest.json"), "utf8")
);

test("the manifest lists the brand icons, each a file in static/", async () => {
  assert.deepEqual(
    manifest.icons.map(({ src, sizes, purpose }) => [src, sizes, purpose]),
    [
      ["icon-192.png", "192x192", "any"],
      ["icon-512.png", "512x512", "any"],
      ["icon-maskable-512.png", "512x512", "maskable"],
    ]
  );
  for (const { src } of manifest.icons) {
    await fs.access(path.join(STATIC, src));
  }
});

test("the manifest's colours are the product background", () => {
  assert.equal(manifest.theme_color, "#101011");
  assert.equal(manifest.background_color, "#101011");
});

test("the manifest carries the names Cat McGee approved, and no SolPg", () => {
  assert.equal(manifest.name, "Solana Playground");
  assert.equal(manifest.short_name, "Playground");
});
