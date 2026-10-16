import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Monaco, xterm and the TextMate grammars get each theme colour through
 * `resolveColor`, which draws a token the page does not define as
 * transparent: a misspelt token would be invisible text, with only a log
 * warning to show for it. So every token the theme names must be defined.
 */
const SRC = path.join(__dirname, "..");

const THEME_SOURCES = [
  "themes/palette.ts",
  "themes/dark/dark.ts",
  "themes/light/light.ts",
  "utils/theme/theme.ts",
];

const TOKEN_SOURCES = [
  "app/styles/playground-tokens.css",
  "app/styles/playground-theme.css",
];

const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

const used = (text: string) =>
  Array.from(text.matchAll(/var\((--[\w-]+)/g), (m) => m[1]);

const defined = (text: string) =>
  Array.from(text.matchAll(/(--[\w-]+)\s*:/g), (m) => m[1]);

describe("theme tokens", () => {
  const tokens = new Set(TOKEN_SOURCES.flatMap((rel) => defined(read(rel))));

  it.each(THEME_SOURCES)("%s names only tokens the page defines", (rel) => {
    const missing = used(read(rel)).filter((token) => !tokens.has(token));
    expect(missing).toEqual([]);
  });
});
