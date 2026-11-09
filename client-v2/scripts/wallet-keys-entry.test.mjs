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

  /**
   * Where Vercel sends a request, in its phase order
   * (`getTransformedRoutes` in `@vercel/routing-utils`): redirects, then the
   * filesystem (static files and `api/` functions), then rewrites. A
   * host-conditioned rule outside `redirects` would run after the app's own
   * files had answered. Sources here are raw regexes, as this file's are.
   */
  const FILES = new Set([
    "/index.html",
    "/runtime.html",
    "/wallet-keys.html",
    "/static/js/main.abc.js",
    "/static/js/wallet-keys.abc.js",
    "/api/agent",
  ]);
  const hostMatches = (has, host) =>
    (has ?? []).every(
      (item) =>
        item.type === "host" &&
        // Unanchored, as the strictest reading: the value anchors itself
        new RegExp(item.value).test(host)
    );
  const routeOf = (host, urlPath) => {
    for (const rule of vercel.redirects ?? []) {
      if (
        new RegExp(`^${rule.source}$`).test(urlPath) &&
        hostMatches(rule.has, host)
      ) {
        return `redirect ${rule.destination}`;
      }
    }
    // `/` is the directory index
    const file = urlPath === "/" ? "/index.html" : urlPath;
    if (FILES.has(file)) return `file ${file}`;
    return "rewrites";
  };

  const KEY_HOST = "wallet-keys.playground.solana.com";
  const APP_HOST = "playground.solana.com";

  it("sends every other path on the key host to the key page, before any file answers", () => {
    for (const urlPath of [
      "/",
      "/index.html",
      "/static/js/main.abc.js",
      "/runtime.html",
      "/api/agent",
      "/some/client/route",
    ]) {
      assert.equal(
        routeOf(KEY_HOST, urlPath),
        "redirect /wallet-keys.html",
        urlPath
      );
    }
    assert.equal(
      routeOf(KEY_HOST, "/wallet-keys.html"),
      "file /wallet-keys.html"
    );
    assert.equal(
      routeOf(KEY_HOST, "/static/js/wallet-keys.abc.js"),
      "file /static/js/wallet-keys.abc.js"
    );
    assert.equal(vercel.redirects[0].permanent, false);
  });

  it("changes nothing on the app's host, nor on a host that only contains the label", () => {
    for (const host of [APP_HOST, "foo-wallet-keys.example.com"]) {
      assert.equal(routeOf(host, "/"), "file /index.html", host);
      assert.equal(routeOf(host, "/api/agent"), "file /api/agent", host);
      assert.equal(routeOf(host, "/some/client/route"), "rewrites", host);
    }
  });

  it("puts no host-conditioned rule in rewrites, where files answer first", () => {
    assert.deepEqual(
      vercel.rewrites.filter((rule) => rule.has),
      []
    );
  });
});
