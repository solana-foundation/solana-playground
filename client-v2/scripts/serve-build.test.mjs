import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { createServer, platformRules } from "./serve-build.mjs";

const vercelJson = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8")
);

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
  let server;
  let buildDir;
  let origin;

  before(async () => {
    buildDir = mkdtempSync(path.join(tmpdir(), "serve-build-"));
    writeFileSync(path.join(buildDir, "index.html"), "<!doctype html>");
    writeFileSync(path.join(buildDir, "x.wasm"), "\0asm");
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
