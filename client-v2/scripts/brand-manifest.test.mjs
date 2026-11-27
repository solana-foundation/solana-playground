// The fork's `public/manifest.json` and `public/og.png` (client-v2-build: "The manifest", "The share image is served").
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PUBLIC = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public"
);
const manifest = JSON.parse(
  await fs.readFile(path.join(PUBLIC, "manifest.json"), "utf8")
);

test("the manifest lists the brand icons, each a file in public/", async () => {
  assert.deepEqual(
    manifest.icons.map(({ src, sizes, purpose }) => [src, sizes, purpose]),
    [
      ["icon-192.png", "192x192", "any"],
      ["icon-512.png", "512x512", "any"],
      ["icon-maskable-512.png", "512x512", "maskable"],
    ]
  );
  for (const { src } of manifest.icons) {
    await fs.access(path.join(PUBLIC, src));
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

test("the share image is a 1200x630 PNG in public/", async () => {
  const png = await fs.readFile(path.join(PUBLIC, "og.png"));

  assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  // Unfurlers skip large images (X caps them at 5 MB); stay well under
  assert.ok(png.length < 1_000_000, `${png.length} bytes`);
});
