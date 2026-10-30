/* eslint-disable no-template-curly-in-string -- the placeholders are the point */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { composeServers } from "./compose.mjs";

/** One entry per rule, as `MCP_SERVERS` would carry it */
const entry = ({ id, url, headers, signedIn }) =>
  JSON.stringify([
    {
      id,
      name: id,
      url,
      ...(headers ? { headers } : {}),
      ...(signedIn ? { signedIn } : {}),
    },
  ]);

describe("composeServers", () => {
  test("fills every placeholder of an entry whose variables are set", () => {
    const servers = composeServers({
      env: { HOST: "mcp.test", TOKEN: "t-1" },
      servers: entry({
        id: "a",
        url: "https://${HOST}/mcp",
        headers: { authorization: "Bearer ${TOKEN}" },
      }),
      signedIn: false,
    });

    assert.deepEqual(servers, [
      {
        id: "a",
        name: "a",
        url: "https://mcp.test/mcp",
        enabled: true,
        headers: { authorization: "Bearer t-1" },
      },
    ]);
  });

  test("leaves out an entry whose url has an unset variable", () => {
    const servers = composeServers({
      env: { HOST: "" },
      servers: entry({ id: "a", url: "https://${HOST}/mcp" }),
      signedIn: false,
    });

    assert.deepEqual(servers, []);
  });

  test("leaves out an entry whose header has an unset variable", () => {
    const servers = composeServers({
      env: {},
      servers: entry({
        id: "a",
        url: "https://mcp.test/mcp",
        headers: { "x-bypass": "${BYPASS}" },
      }),
      signedIn: false,
    });

    assert.deepEqual(servers, []);
  });

  test("drops only the header whose variable fell back to empty", () => {
    const servers = composeServers({
      env: { BYPASS: "b-1" },
      servers: entry({
        id: "a",
        url: "https://mcp.test/mcp",
        headers: {
          "x-bypass": "${BYPASS}",
          authorization: "Bearer ${TOKEN:-}",
        },
      }),
      signedIn: false,
    });

    assert.deepEqual(servers[0].headers, { "x-bypass": "b-1" });
  });

  test("fills a placeholder's default when its variable is unset", () => {
    const servers = composeServers({
      env: {},
      servers: entry({ id: "a", url: "${HOST:-https://mcp.test/mcp}" }),
      signedIn: false,
    });

    assert.equal(servers[0].url, "https://mcp.test/mcp");
  });

  test("withholds a signedIn entry from a signed-out caller", () => {
    const servers = entry({
      id: "a",
      url: "https://mcp.test/mcp",
      signedIn: true,
    });

    assert.deepEqual(composeServers({ env: {}, servers, signedIn: false }), []);
    assert.equal(
      composeServers({ env: {}, servers, signedIn: true })[0].id,
      "a"
    );
  });

  test("serves both official servers to a signed-out caller with nothing set", () => {
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

  test("replaces the catalogue with MCP_SERVERS", () => {
    const servers = composeServers({
      env: {},
      servers: entry({ id: "mine", url: "https://mcp.test/mcp" }),
      signedIn: true,
    });

    assert.deepEqual(
      servers.map((s) => s.id),
      ["mine"]
    );
  });

  test("rejects a duplicate id", () => {
    const one = { id: "a", url: "https://mcp.test/mcp" };

    assert.throws(
      () =>
        composeServers({
          env: {},
          servers: JSON.stringify([one, one]),
          signedIn: true,
        }),
      /duplicate id "a"/
    );
  });
});
