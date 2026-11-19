/**
 * The security headers every response carries, read from `vercel.json` (the
 * one source the deployment and `scripts/serve-build.mjs` both apply). The
 * dev server sets only COEP and COOP (`craco.config.js`), so `yarn dev` runs
 * without this policy.
 *
 * - Framing by another site is refused. `frame-ancestors` only works in an
 *   enforcing `Content-Security-Policy` (browsers ignore it in a Report-Only
 *   one), and `X-Frame-Options` covers browsers that predate it.
 * - Images load only from this origin, `data:`/`blob:` (wallet-standard icons
 *   are data URIs) and the hosts listed below.
 * - Connections go to this origin, to any `https:`/`wss:` host, and to the
 *   local machine. A user can point the app at their own RPC endpoint, build
 *   server or model endpoint (Settings), so a host list would break those; a
 *   plain `http:`/`ws:` endpoint works only on the local machine.
 * - `Cross-Origin-Embedder-Policy`/`Cross-Origin-Opener-Policy` stay: the Rust
 *   analyzer starts only on a cross-origin isolated page (`rust-analyzer.ts`).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { platformRules } from "./scripts/serve-build.mjs";

const { headers } = platformRules(
  JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8"))
);

/** A CSP header's directives, in header order, as `[name, sources]` */
const directiveList = (value) =>
  (value ?? "")
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .filter(([name]) => name)
    .map(([name, ...sources]) => [name.toLowerCase(), sources]);

const enforcedList = directiveList(headers["Content-Security-Policy"]);
const enforced = Object.fromEntries(enforcedList);
const reportOnly = Object.fromEntries(
  directiveList(headers["Content-Security-Policy-Report-Only"])
);

// No "[::1]": CSP host sources have no IPv6 literal form, so browsers drop it
// with a console warning, and the check below fails on one.
const LOOPBACK = ["localhost", "127.0.0.1"];

describe("vercel.json security headers", () => {
  it("names each directive once, since a browser reads only the first", () => {
    const names = enforcedList.map(([name]) => name);
    assert.deepEqual(names, Array.from(new Set(names)));
  });

  it("refuses framing by any site, in the enforcing policy", () => {
    assert.deepEqual(enforced["frame-ancestors"], ["'none'"]);
    assert.equal(reportOnly["frame-ancestors"], undefined);
    assert.equal(headers["X-Frame-Options"], "DENY");
  });

  it("enforces images from this origin and the listed hosts only", () => {
    assert.deepEqual(enforced["img-src"], [
      "'self'",
      "data:",
      "blob:",
      // GitHub avatars: the signed-in user, catalog program icons
      "https://avatars.githubusercontent.com",
      // program icons in the catalog
      "https://raw.githubusercontent.com",
      // Google Analytics beacons
      "https://*.google-analytics.com",
      "https://*.googletagmanager.com",
      "https://*.g.doubleclick.net",
      "https://www.google.com",
    ]);
  });

  it("enforces connections to this origin, secure hosts and the local machine", () => {
    const connect = enforced["connect-src"];
    assert.ok(connect, "connect-src is enforced");
    for (const source of ["'self'", "https:", "wss:"]) {
      assert.ok(connect.includes(source), source);
    }
    for (const host of LOOPBACK) {
      assert.ok(connect.includes(`http://${host}:*`), `http://${host}`);
      assert.ok(connect.includes(`ws://${host}:*`), `ws://${host}`);
    }
    for (const source of connect) {
      if (["'self'", "https:", "wss:"].includes(source)) continue;
      const loopback = source.match(/^(?:http|ws):\/\/(.+):\*$/)?.[1];
      assert.ok(LOOPBACK.includes(loopback), `${source} is not loopback`);
    }
  });

  it("keeps the cross-origin isolation headers", () => {
    assert.equal(headers["Cross-Origin-Embedder-Policy"], "require-corp");
    assert.equal(headers["Cross-Origin-Opener-Policy"], "same-origin");
  });
});
