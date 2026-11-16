/**
 * The security headers every page response carries, read from `vercel.json`
 * (the one source the deployment and `scripts/serve-build.mjs` both apply).
 *
 * - Framing by another site is refused. `frame-ancestors` only works in an
 *   enforcing `Content-Security-Policy` (browsers ignore it in a Report-Only
 *   one), and `X-Frame-Options` covers browsers that predate it.
 * - Images load only from this origin and the few hosts the app shows images
 *   from.
 * - Connections go to this origin, to any `https:`/`wss:` host, and to a local
 *   node or build server. A user can point the app at any RPC endpoint or build
 *   server (Settings), so a host list would break that; the policy still
 *   refuses plain-`http:` hosts other than the local machine.
 * - `Cross-Origin-Embedder-Policy`/`Cross-Origin-Opener-Policy` stay: the Rust
 *   analyzer worker needs a cross-origin isolated page.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { platformRules } from "./scripts/serve-build.mjs";

const { headers } = platformRules(
  JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8"))
);

/** A CSP header's directives, as `name -> sources` */
const directives = (value = "") =>
  Object.fromEntries(
    value
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name, sources])
  );

const enforced = directives(headers["Content-Security-Policy"]);
const reportOnly = directives(headers["Content-Security-Policy-Report-Only"]);
/**
 * A directive from whichever CSP header carries it, so `img-src` and
 * `connect-src` may move to a Report-Only header for a rollout
 */
const directive = (name) => enforced[name] ?? reportOnly[name];

describe("vercel.json security headers", () => {
  it("refuses framing by any site, in the enforcing policy", () => {
    assert.deepEqual(enforced["frame-ancestors"], ["'none'"]);
    assert.equal(reportOnly["frame-ancestors"], undefined);
    assert.equal(headers["X-Frame-Options"], "DENY");
  });

  it("loads images only from this origin and a short host list", () => {
    const img = directive("img-src");
    assert.ok(img, "img-src is set");
    assert.ok(img.includes("'self'"));
    for (const source of img) {
      assert.doesNotMatch(source, /^(\*|https?:|http:\/\/\*)$/, source);
    }
  });

  it("connects to this origin, secure hosts and the local machine only", () => {
    const connect = directive("connect-src");
    assert.ok(connect, "connect-src is set");
    for (const source of ["'self'", "https:", "wss:"]) {
      assert.ok(connect.includes(source), source);
    }
    assert.ok(!connect.includes("*"));
    assert.ok(!connect.includes("http:"));
    assert.ok(!connect.includes("ws:"));
  });

  it("keeps the cross-origin isolation headers", () => {
    assert.equal(headers["Cross-Origin-Embedder-Policy"], "require-corp");
    assert.equal(headers["Cross-Origin-Opener-Policy"], "same-origin");
  });
});
