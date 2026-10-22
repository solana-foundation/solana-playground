import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveApiRoute } from "./api-route.mjs";

describe("resolveApiRoute", () => {
  it("resolves a flat route", () => {
    assert.deepEqual(resolveApiRoute("/health"), { name: "health" });
  });

  it("ignores the query string", () => {
    assert.deepEqual(resolveApiRoute("/sync?x=1"), { name: "sync" });
  });

  it("resolves a nested path to its first segment, for catch-all routes", () => {
    assert.deepEqual(resolveApiRoute("/auth/callback/github"), {
      name: "auth",
    });
  });

  it("refuses traversal", () => {
    assert.equal(resolveApiRoute("/../secrets"), null);
    assert.equal(resolveApiRoute("/auth/../../etc/passwd"), null);
  });

  it("refuses an empty or malformed first segment", () => {
    assert.equal(resolveApiRoute("/"), null);
    assert.equal(resolveApiRoute("/Health"), null);
  });
});
