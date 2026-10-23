// The webfonts arrive through an `@import`, which a browser applies only ahead of every rule but `@charset` and `@layer` statements
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const CSS = path.join(import.meta.dirname, "..", "build", "static", "css");
/** What the design system lays into a product; client-v2 loads the same fonts */
const INJECT = path.join(
  import.meta.dirname,
  "..",
  "..",
  "design-system",
  "src",
  "styles",
  "inject.css"
);

const IMPORT =
  /^@import\s*(?:url\(\s*(["']?)([^"')]*)\1\s*\)|(["'])(.*?)\3)[^;]*;/;

/** The URLs of the `@import` statements a browser applies: those before the first other rule */
const leadingImports = (css) => {
  const urls = [];
  let rest = css;
  for (;;) {
    rest = rest.replace(
      /^(?:\s|\/\*[\s\S]*?\*\/|@charset\s*"[^"]*";|@layer\s[^{;]*;)+/,
      ""
    );
    const match = IMPORT.exec(rest);
    if (!match) return urls;
    urls.push(match[2] ?? match[4]);
    rest = rest.slice(match[0].length);
  }
};

/** The family a font token names first, as Google Fonts spells it in a URL */
const firstFamily = (css, token) => {
  const match = new RegExp(`${token}:\\s*"([^"]+)"`).exec(css);
  assert.ok(match, `the built CSS does not define ${token}`);
  return match[1].replaceAll(" ", "+");
};

test("the main stylesheet leads with the design system's webfont import", async () => {
  const names = (await fs.readdir(CSS)).filter((name) =>
    /^main\..*\.css$/.test(name)
  );
  assert.equal(
    names.length,
    1,
    `expected one main.*.css under ${CSS}, found ${names.length}`
  );
  const css = await fs.readFile(path.join(CSS, names[0]), "utf8");
  const imports = leadingImports(css);
  const shown = imports.join("\n") || "(none)";

  const [fonts] = leadingImports(await fs.readFile(INJECT, "utf8"));
  assert.ok(fonts, `${INJECT} has no leading @import`);
  assert.ok(
    imports.includes(fonts),
    `${names[0]} does not lead with the import inject.css makes (src/index.css), so the page renders in the fallback font.\nExpected: ${fonts}\nLeading imports:\n${shown}`
  );

  for (const token of ["--font-headline", "--font-text"]) {
    const family = firstFamily(css, token);
    assert.ok(
      imports.some((url) => url.includes(`family=${family}:`)),
      `${token} names ${family}, which no leading import loads.\nLeading imports:\n${shown}`
    );
  }
});
