import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { composeServers } from "./compose.mjs";

/** `SOURCES` holding one `mcp` entry */
const one = (id, url) => JSON.stringify([{ kind: "mcp", id, name: id, url }]);

describe("composeServers", () => {
  test("Explorer with nothing set: listed, with no bypass and no authorization header", () => {
    const servers = composeServers({ env: {}, signedIn: false });

    assert.deepEqual(
      servers.map((s) => s.id),
      ["solana", "explorer"]
    );
    assert.deepEqual(servers[1].headers, {});
    assert.equal(servers[1].protection, undefined);
  });

  test("protects Explorer only when its bypass is set", () => {
    const servers = composeServers({
      env: { MCP_EXPLORER_BYPASS: "b-1" },
      signedIn: false,
    });

    assert.deepEqual(servers[1].protection, {
      provider: "vercel",
      secret: "b-1",
    });
  });

  test("lists no skill as a server", () => {
    const override = JSON.stringify([
      {
        kind: "skill",
        id: "s",
        name: "s",
        description: "d",
        source: { type: "bundled" },
      },
    ]);

    assert.deepEqual(composeServers({ env: {}, override, signedIn: true }), []);
  });

  test("rejects an id holding the tool-name separator", () => {
    assert.throws(
      () =>
        composeServers({
          env: {},
          override: one("team__docs", "https://mcp.test/mcp"),
          signedIn: true,
        }),
      /must not contain "__"/
    );
  });

  test("rejects a relative url, which only the browser can resolve", () => {
    assert.throws(
      () =>
        composeServers({
          env: {},
          override: one("docs", "/api/docs-mcp"),
          signedIn: true,
        }),
      /SOURCES: server "docs" needs an https:\/\/ url/
    );
  });
});
