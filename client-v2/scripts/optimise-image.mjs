// The output depends on the pinned svgo and sharp, so a bump of either re-optimises every image in `public/`.
// Usage: node scripts/optimise-image.mjs <file>...   rewrites each file in place

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { optimize } from "svgo";

/** mozjpeg quality for every JPEG; a change re-encodes every JPEG in `public/` */
export const JPEG_QUALITY = 80;

/** Share of its size a JPEG re-encode must save; a second pass saves less, so an optimised JPEG stays a fixed point */
export const JPEG_MIN_SAVING = 0.1;

const jpeg = {
  encode: (bytes) =>
    sharp(bytes)
      .autoOrient()
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer(),
  minSaving: JPEG_MIN_SAVING,
};

const OPTIMISERS = {
  ".svg": {
    encode: async (bytes) =>
      Buffer.from(optimize(bytes.toString("utf8"), { multipass: true }).data),
    minSaving: 0,
  },
  ".png": {
    // `palette: false` keeps the encode lossless; sharp quantises otherwise
    encode: (bytes) =>
      sharp(bytes)
        .autoOrient()
        .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
        .toBuffer(),
    minSaving: 0,
  },
  ".jpg": jpeg,
  ".jpeg": jpeg,
};

/** Whether `optimiseImage` rewrites files of this name's type */
export const isOptimisable = (name) =>
  Object.hasOwn(OPTIMISERS, path.extname(name).toLowerCase());

/**
 * The optimised bytes of an image, by its name's extension; any other type,
 * and a result that does not save its type's `minSaving`, returns `bytes` unchanged.
 */
export const optimiseImage = async (name, bytes) => {
  const optimiser = OPTIMISERS[path.extname(name).toLowerCase()];
  if (!optimiser) return bytes;
  const optimised = await optimiser.encode(bytes);
  return optimised.length < bytes.length * (1 - optimiser.minSaving)
    ? optimised
    : bytes;
};

if (path.basename(process.argv[1] ?? "") === "optimise-image.mjs") {
  const totals = {};
  for (const file of process.argv.slice(2)) {
    const bytes = await fs.readFile(file);
    const optimised = await optimiseImage(file, bytes);
    if (optimised !== bytes) await fs.writeFile(file, optimised);
    const type = path.extname(file).toLowerCase();
    totals[type] ??= { files: 0, before: 0, after: 0 };
    totals[type].files += 1;
    totals[type].before += bytes.length;
    totals[type].after += optimised.length;
  }
  for (const [type, { files, before, after }] of Object.entries(totals))
    console.log(`${type}: ${files} files, ${before} -> ${after} bytes`);
}
