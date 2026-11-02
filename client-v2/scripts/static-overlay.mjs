/**
 * Copy the fork's own static files (`client-v2/static`) over the mirror of
 * upstream's `client/public` that `update-static.mjs` writes into `public/`.
 *
 * Upstream's assets submodule stays byte-identical; a file the fork curates
 * differently (the program gallery's `programs/programs.json`) lives under
 * `static/` at the path it is served from and wins over upstream's copy.
 * Markdown and dotfiles there are never served (`isServed`).
 */
import fs from "fs/promises";
import path from "path";

/**
 * A regular file that is not Markdown (it documents the files beside it) and
 * not a dotfile (`.DS_Store`, editor swap files)
 *
 * @param {import("fs").Dirent} entry
 */
const isServed = (entry) =>
  entry.isFile() && !entry.name.startsWith(".") && !entry.name.endsWith(".md");

/**
 * @param {string} from the fork's static directory
 * @param {string} to the served directory, already holding upstream's mirror
 * @returns {Promise<string[]>} the copied paths, relative to `to`
 */
export const overlayStatic = async (from, to) => {
  const entries = await fs.readdir(from, {
    recursive: true,
    withFileTypes: true,
  });
  const copied = [];
  for (const entry of entries) {
    if (!isServed(entry)) continue;
    const source = path.join(entry.parentPath, entry.name);
    const relative = path.relative(from, source);
    const target = path.join(to, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    copied.push(relative);
  }
  return copied.sort();
};
