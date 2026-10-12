// Fails when a colour literal appears in `src/` outside the token bridge.
// Every colour comes from the design system's tokens; this keeps a new
// literal from landing quietly. Run: `yarn check-colors`. Named colours
// (`white`, `red`) are not caught: the words are too common in code to tell
// apart from a colour without parsing CSS.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");

/**
 * A hex colour (not an HTML entity like `&#8592;`), or the start of a CSS
 * colour function
 */
const COLOR =
  /(?<!&)#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\bcolor\(srgb/g;

/** Where a colour literal belongs, relative to `src/` */
const ALLOWED = [
  // The installed tokens, never edited by hand
  /^app\/styles\/playground-[a-z]+\.css$/,
  // The resolver's own sentinel and transparent, and its parsing tests
  /^shared\/lib\/css-color\//,
  // Third-party logos keep their own colours on every ground
  /^languages\//,
];

const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".css",
  ".svg",
  ".js",
  ".jsx",
  ".mjs",
  ".html",
]);

export const isAllowed = (relPath) => ALLOWED.some((re) => re.test(relPath));

export const findColors = (text) =>
  text
    .split("\n")
    .flatMap((line, i) =>
      [...line.matchAll(COLOR)].map((m) => ({ line: i + 1, match: m[0] }))
    );

const walk = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return EXTENSIONS.has(path.extname(e.name)) ? [full] : [];
    })
  );
  return nested.flat();
};

const main = async () => {
  const hits = [];
  for (const file of await walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    if (isAllowed(rel)) continue;
    const text = await fs.readFile(file, "utf8");
    for (const { line, match } of findColors(text)) {
      hits.push(`src/${rel}:${line}  ${match}`);
    }
  }
  if (hits.length) {
    console.error(
      "Colour literals outside the token bridge (use a token from " +
        `src/app/styles/playground-tokens.css):\n${hits.join("\n")}`
    );
    process.exit(1);
  }
  console.log("No colour literals outside the token bridge.");
};

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
