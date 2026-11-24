import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { PRODUCTION_HOST } from "./robots.mjs";
import { createServer, platformRules } from "./serve-build.mjs";

const vercelJson = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8")
);

/** What the sandbox's page must be served with, whoever frames it */
const RUNTIME_CSP = "sandbox allow-scripts; frame-ancestors 'self'";

describe("platformRules", () => {
  it("takes the COOP and COEP headers the app needs from vercel.json", () => {
    const headers = platformRules(vercelJson).headersFor("/");
    assert.equal(headers["Cross-Origin-Embedder-Policy"], "require-corp");
    assert.equal(headers["Cross-Origin-Opener-Policy"], "same-origin");
  });

  it("adds the sandbox's CORP header to /static/ paths only", () => {
    const { headersFor } = platformRules(vercelJson);
    const asset = headersFor("/static/js/main.js");
    assert.equal(asset["Cross-Origin-Resource-Policy"], "cross-origin");
    assert.equal(asset["Cross-Origin-Embedder-Policy"], "require-corp");
    // The sandbox loads its scripts with `crossorigin`, from an opaque origin
    assert.equal(asset["Access-Control-Allow-Origin"], "*");
    assert.equal(headersFor("/")["Cross-Origin-Resource-Policy"], undefined);
    assert.equal(headersFor("/")["Access-Control-Allow-Origin"], undefined);
    assert.equal(
      headersFor("/staticky")["Cross-Origin-Resource-Policy"],
      undefined
    );
  });

  it("serves /runtime.html sandboxed and framed by the app alone", () => {
    const { headersFor } = platformRules(vercelJson);
    assert.equal(
      headersFor("/runtime.html")["Content-Security-Policy"],
      RUNTIME_CSP
    );
    // Firefox checks the frame's own load against the app's COEP as a
    // cross-origin request, since the `sandbox` attribute makes it opaque
    assert.equal(
      headersFor("/runtime.html")["Cross-Origin-Resource-Policy"],
      "cross-origin"
    );
    // The app's own policy, never the sandbox's
    assert.notEqual(headersFor("/")["Content-Security-Policy"], RUNTIME_CSP);
    assert.equal(
      headersFor("/runtime.html.map")["Content-Security-Policy"],
      headersFor("/")["Content-Security-Policy"]
    );
  });

  it("refuses a header rule it would not apply", () => {
    assert.throws(() =>
      platformRules({ headers: [{ source: "/:path*", headers: [] }] })
    );
  });

  it("keeps X-Robots-Tag off the production host only", () => {
    const { headersFor } = platformRules(vercelJson);
    assert.equal(headersFor("/", PRODUCTION_HOST)["X-Robots-Tag"], undefined);
    for (const host of [
      "solana-playground-teal.vercel.app",
      "solana-playground-git-x-hoodies.vercel.app",
      "localhost",
    ]) {
      assert.equal(
        headersFor("/flow/lesson", host)["X-Robots-Tag"],
        "noindex, nofollow"
      );
    }
  });

  it("matches a host condition whole, never a host that only contains it", () => {
    const { headersFor } = platformRules(vercelJson);
    assert.equal(
      headersFor("/", `${PRODUCTION_HOST}.example.com`)["X-Robots-Tag"],
      "noindex, nofollow"
    );
  });

  it("refuses a condition it would not apply", () => {
    assert.throws(() =>
      platformRules({
        headers: [
          {
            source: "/(.*)",
            has: [{ type: "cookie", key: "x" }],
            headers: [],
          },
        ],
      })
    );
  });
});

describe("createServer", () => {
  let server;
  let buildDir;
  let origin;

  before(async () => {
    buildDir = mkdtempSync(path.join(tmpdir(), "serve-build-"));
    writeFileSync(path.join(buildDir, "index.html"), "<!doctype html>");
    writeFileSync(path.join(buildDir, "x.wasm"), "\0asm");
    writeFileSync(path.join(buildDir, "runtime.html"), "<!doctype html>");
    server = createServer({ buildDir, config: vercelJson });
    await new Promise((resolve) => {
      server = server.listen(0, resolve);
    });
    origin = `http://localhost:${server.address().port}`;
  });

  after(() => {
    server.close();
    rmSync(buildDir, { recursive: true, force: true });
  });

  // `origin` is set in `before`, so a test reads it through this function when it runs
  const urlOf = (pathname) => `${origin}${pathname}`;

  for (const [pathname, status, contentType] of [
    ["/api/health", 200, /^application\/json/],
    ["/api/no-such-route", 404, /^application\/json/],
    ["/x.wasm", 200, /^application\/wasm/],
    // The SPA fallback answers an app path, never a missing asset
    ["/flow/lesson", 200, /^text\/html/],
    ["/static/js/gone.js", 404, /^text\/plain/],
  ]) {
    it(`answers ${pathname} with ${status}`, async () => {
      const res = await fetch(urlOf(pathname));
      assert.equal(res.status, status);
      assert.match(res.headers.get("content-type"), contentType);
      assert.equal(
        res.headers.get("cross-origin-embedder-policy"),
        "require-corp"
      );
    });
  }

  it("sends the sandbox's CSP with /runtime.html", async () => {
    const res = await fetch(urlOf("/runtime.html"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-security-policy"), RUNTIME_CSP);
    assert.notEqual(
      (await fetch(urlOf("/"))).headers.get("content-security-policy"),
      RUNTIME_CSP
    );
  });

  /** A GET with the `Host` header set, which `fetch` cannot send */
  const headOf = (pathname, host) =>
    new Promise((resolve, reject) => {
      http
        .get(urlOf(pathname), { headers: { host } }, (res) => {
          res.resume();
          resolve(res.headers);
        })
        .on("error", reject);
    });

  it("sends X-Robots-Tag to every host but production's", async () => {
    assert.equal(
      (await headOf("/", "solana-playground-teal.vercel.app"))["x-robots-tag"],
      "noindex, nofollow"
    );
    assert.equal(
      (await headOf("/", PRODUCTION_HOST))["x-robots-tag"],
      undefined
    );
  });

  it("names the unknown /api path in the 404", async () => {
    const res = await fetch(`${origin}/api/no-such-route`);
    assert.deepEqual(await res.json(), {
      error: "No API route at /api/no-such-route",
    });
  });

  it("keeps serving after a path no file can have", async () => {
    const res = await fetch(`${origin}/%00`);
    assert.ok(res.status < 500, `answered ${res.status}`);
    assert.equal((await fetch(`${origin}/x.wasm`)).status, 200);
  });
});
