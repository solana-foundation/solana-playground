import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const cwd = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const ts = require("typescript");

const KEY_ORIGIN = path.join(cwd, "src/utils/wallet/key-origin");
const FRAME = path.join(KEY_ORIGIN, "frame");
/** The only files outside `frame/` the key page may load */
const SHARED = new Set(
  ["protocol.ts", "origin.ts"].map((f) => path.join(KEY_ORIGIN, f))
);
/** The only package the key page may load */
const PACKAGES = new Set(["@noble/ed25519"]);

/**
 * The extra pages `craco.config.js` builds (its `PAGES`), read from its text
 * so the test builds nothing: entry name -> entry file
 */
const cracoPages = () => {
  const source = fs.readFileSync(path.join(cwd, "craco.config.js"), "utf8");
  const constants = new Map(
    Array.from(source.matchAll(/^const (\w+) = "([^"]+)";$/gm), ([, n, v]) => [
      n,
      v,
    ])
  );
  const valueOf = (token) =>
    token.startsWith('"') ? token.slice(1, -1) : constants.get(token);
  const pages = new Map();
  const pattern =
    /entry: (\w+|"[^"]+"),\s*page: (?:\w+|"[^"]+"),\s*source: "([^"]+)"/g;
  for (const [, entry, file] of source.matchAll(pattern)) {
    pages.set(valueOf(entry), path.join(cwd, file));
  }
  return pages;
};

const isVitestBlock = (node) =>
  ts.isIfStatement(node) && node.expression.getText() === "import.meta.vitest";

/**
 * Every module `file` loads when it runs: imports and re-exports, `import()`
 * and `require()`. In-source test blocks are left out, since the build drops
 * them (`import.meta.vitest` is `undefined` there).
 */
const specifiersOf = (file) => {
  const sourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const found = [];
  const visit = (node) => {
    if (isVitestBlock(node)) return;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      const [arg] = node.arguments;
      found.push(arg && ts.isStringLiteral(arg) ? arg.text : "<dynamic>");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
};

const resolveRelative = (from, specifier) => {
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ];
  const hit = candidates.find(
    (c) => fs.existsSync(c) && fs.statSync(c).isFile()
  );
  if (!hit) throw new Error(`${from}: cannot resolve ${specifier}`);
  return hit;
};

/** The source files and packages reachable from `entry` */
const graphOf = (entry) => {
  const files = new Set();
  const packages = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith("."))
        pending.push(resolveRelative(file, specifier));
      else packages.add(specifier);
    }
  }
  return { files, packages };
};

describe("the key page's entry", () => {
  it("is built from key-origin/frame/index.ts", () => {
    assert.equal(cracoPages().get("wallet-keys"), path.join(FRAME, "index.ts"));
  });

  it("loads only key-origin/frame, protocol.ts, origin.ts and @noble/ed25519", () => {
    const { files, packages } = graphOf(path.join(FRAME, "index.ts"));
    const outside = [...files].filter(
      (f) => !f.startsWith(`${FRAME}${path.sep}`) && !SHARED.has(f)
    );
    assert.deepEqual(outside, []);
    assert.deepEqual(
      [...packages].filter((p) => !PACKAGES.has(p)),
      []
    );
    // The walk itself works: it reaches the handler and the protocol
    assert.ok(files.has(path.join(FRAME, "handler.ts")));
    assert.ok(files.has(path.join(KEY_ORIGIN, "protocol.ts")));
  });
});

describe("vercel.json for the key page", () => {
  const vercel = JSON.parse(
    fs.readFileSync(path.join(cwd, "vercel.json"), "utf8")
  );
  const headersOf = (source) =>
    Object.fromEntries(
      vercel.headers
        .find((rule) => rule.source === source)
        .headers.map((h) => [h.key, h.value])
    );

  it("serves wallet-keys.html with its own CSP, framable cross-origin", () => {
    assert.deepEqual(headersOf("/wallet-keys.html"), {
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self' https://*.vercel.app http://localhost:* http://127.0.0.1:* https://playground.solana.com",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
  });

  it("refuses every other path on the key host, before any other rewrite", () => {
    assert.deepEqual(vercel.rewrites[0], {
      source: "/((?!wallet-keys\\.html|static/js/wallet-keys).*)",
      has: [{ type: "host", value: "wallet-keys\\..*" }],
      destination: "/404",
    });
    const refused = new RegExp(`^${vercel.rewrites[0].source}$`);
    assert.ok(refused.test("/index.html"));
    assert.ok(refused.test("/static/js/main.1234.js"));
    assert.ok(refused.test("/api/agent"));
    assert.ok(!refused.test("/wallet-keys.html"));
    assert.ok(!refused.test("/static/js/wallet-keys.1234.js"));
  });
});
