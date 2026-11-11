import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { isOptimisable, optimiseImage } from "./optimise-image.mjs";

const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A 64x64 picture of fixed noise, so a JPEG quality change shows in the size */
const picture = () =>
  sharp(
    Buffer.from(
      Array.from({ length: 64 * 64 * 3 }, (_, i) => (i * i * 31) % 256)
    ),
    { raw: { width: 64, height: 64, channels: 3 } }
  );

const pixels = (bytes) => sharp(bytes).ensureAlpha().raw().toBuffer();

for (const [file, input] of [
  [
    "a.svg",
    async () =>
      Buffer.from(
        '<?xml version="1.0"?>\n<!-- a comment -->\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">\n  <rect x="0" y="0" width="10" height="10" fill="#ff0000"/>\n</svg>\n'
      ),
  ],
  ["a.jpg", () => picture().jpeg({ quality: 100 }).toBuffer()],
])
  test(`shrinks ${file}`, async () => {
    const bytes = await input();
    assert.ok((await optimiseImage(file, bytes)).length < bytes.length);
  });

test("shrinks a PNG without changing a pixel", async () => {
  const bytes = await picture().png({ compressionLevel: 0 }).toBuffer();
  const optimised = await optimiseImage("a.png", bytes);
  assert.ok(optimised.length < bytes.length);
  assert.deepEqual(await pixels(optimised), await pixels(bytes));
});

test("returns a file of another type unchanged", async () => {
  const bytes = await picture().webp().toBuffer();
  assert.equal(await optimiseImage("a.webp", bytes), bytes);
});

test("keeps an image whose re-encode is not smaller", async () => {
  // Indexed PNG: the lossless full-colour encode comes out larger
  const bytes = await picture().png({ palette: true, colours: 2 }).toBuffer();
  assert.equal(await optimiseImage("a.png", bytes), bytes);
});

test("every image in public/, src/tutorials/, and src/frameworks/ is already optimised", async () => {
  const files = execFileSync(
    "git",
    [
      "-C",
      CLIENT,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "public",
      "src/tutorials",
      "src/frameworks",
    ],
    { encoding: "utf8" }
  )
    .split("\n")
    .filter(
      (file) => isOptimisable(file) && existsSync(path.join(CLIENT, file))
    );
  assert.ok(files.length > 0);
  const unoptimised = [];
  for (const file of files) {
    const bytes = await fs.readFile(path.join(CLIENT, file));
    if (!(await optimiseImage(file, bytes)).equals(bytes))
      unoptimised.push(file);
  }
  assert.deepEqual(
    unoptimised,
    [],
    "run: node scripts/optimise-image.mjs <file>..."
  );
});
