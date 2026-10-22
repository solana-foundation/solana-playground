import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createServer, platformRules, resolveRequest } from "./serve-build.mjs";

const vercelJson = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8")
);
const { spaFallback } = platformRules(vercelJson);
const BUILD = "/srv/build";

describe("resolveRequest", () => {
  const existing = new Set([`${BUILD}/static/js/main.js`]);
  const isFile = (file) => existing.has(file);
  const resolve = (pathname, check = isFile) =>
    resolveRequest(pathname, { buildDir: BUILD, spaFallback, isFile: check });

  for (const [pathname, expected] of [
    ["/api/auth/get-session", { kind: "api" }],
    [
      "/static/js/main.js",
      { kind: "file", file: `${BUILD}/static/js/main.js` },
    ],
    ["/flow/lesson", { kind: "file", file: `${BUILD}/index.html` }],
    ["/static/js/gone.js", { kind: "missing" }],
    ["/gone.png", { kind: "missing" }],
  ]) {
    it(`answers ${pathname} with ${expected.kind}`, () => {
      assert.deepEqual(resolve(pathname), expected);
    });
  }

  it("never serves a file outside the build folder", () => {
    assert.deepEqual(
      resolve("/../package.json", () => true),
      {
        kind: "missing",
      }
    );
  });
});

describe("platformRules", () => {
  it("takes the COOP and COEP headers the app needs from vercel.json", () => {
    const { headers } = platformRules(vercelJson);
    assert.equal(headers["Cross-Origin-Embedder-Policy"], "require-corp");
    assert.equal(headers["Cross-Origin-Opener-Policy"], "same-origin");
  });

  it("refuses a header rule it would not apply", () => {
    assert.throws(() =>
      platformRules({ headers: [{ source: "/static/(.*)", headers: [] }] })
    );
  });
});

describe("createServer", () => {
  it("answers an unknown /api path from the dispatcher, not the SPA", async () => {
    const server = createServer({ buildDir: BUILD, config: vercelJson });
    await new Promise((resolve) => server.listen(0, resolve));
    try {
      const res = await fetch(
        `http://localhost:${server.address().port}/api/no-such-route`
      );
      assert.equal(res.status, 404);
      assert.equal(res.headers.get("content-type"), "application/json");
      assert.equal(
        res.headers.get("cross-origin-embedder-policy"),
        "require-corp"
      );
    } finally {
      server.close();
    }
  });
});
