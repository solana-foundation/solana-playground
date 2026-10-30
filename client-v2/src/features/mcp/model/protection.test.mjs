import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { validateServers } from "./entry.mjs";
import { protectionHeaders, protectionQuery } from "./protection.mjs";

const vercel = { provider: "vercel", secret: "b-1" };

const server = (protection) => ({
  id: "a",
  url: "https://mcp.test/mcp",
  protection,
});

describe("protection", () => {
  test("carries a Vercel bypass in its header for the gateway", () => {
    assert.deepEqual(protectionHeaders(vercel), {
      "x-vercel-protection-bypass": "b-1",
    });
  });

  test("carries a Vercel bypass in its query parameter for the browser", () => {
    assert.deepEqual(protectionQuery(vercel), {
      "x-vercel-protection-bypass": "b-1",
    });
  });

  test("adds nothing to a server without protection", () => {
    assert.deepEqual(protectionHeaders(undefined), {});
    assert.deepEqual(protectionQuery(undefined), {});
  });

  test("keeps a protection with a provider and a secret", () => {
    assert.deepEqual(validateServers([server(vercel)])[0].protection, vercel);
  });

  test("drops a protection whose secret is absent, as an unset placeholder leaves it", () => {
    const [entry] = validateServers([server({ provider: "vercel" })]);

    assert.equal(entry.protection, undefined);
  });

  for (const [name, protection, message] of [
    [
      "an unknown provider",
      { provider: "cloudflare", secret: "s" },
      /one of: vercel/,
    ],
    ["a blank secret", { provider: "vercel", secret: " " }, /secret is empty/],
    ["a string in place of an object", "vercel", /must be an object/],
  ]) {
    test(`rejects ${name}`, () => {
      assert.throws(() => validateServers([server(protection)]), message);
    });
  }
});
