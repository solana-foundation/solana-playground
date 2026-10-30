import { validateServers } from "./entry.mjs";
import { protectionQuery } from "./protection.mjs";
import type { McpServerEntry } from "./types";

/**
 * Extra MCP servers, added from the client.
 *
 * **Not the source of truth.** The gateway (`api/mcp.mjs`) owns the list,
 * composed from `model/catalogue.mjs` and the environment by
 * `composeServers`, and the panel asks it at startup, so enabling an upstream
 * is a deploy plus an env var rather than a client change — that is how an
 * operator turns Explorer on without shipping anything. Why the gateway
 * withholds Explorer from a request is `explorerWithheld` in `api/mcp.mjs`,
 * with `EXPLORER_HINTS` saying what to do about each reason.
 *
 * This list is only for servers wanted *in addition*: something CORS-open a
 * page can reach directly. Empty by default, and deliberately not a mirror of
 * what the gateway serves, since two lists would disagree.
 */
export const LOCAL_MCP_SERVERS: McpServerEntry[] = [];

/** A server's URL with its `queryParams` and bot-protection bypass folded in */
export const serverUrl = (server: McpServerEntry) => {
  // Relative for our own gateway (`/api/mcp?...`), absolute for anything else
  const url = new URL(server.url.trim(), window.location.origin);
  // In the query, not a header: a custom header must pass the upstream's CORS preflight
  const query = {
    ...protectionQuery(server.protection),
    ...server.queryParams,
  };
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.href;
};

/** Pretty-print the server list for the editor */
export const serializeServers = (servers: readonly McpServerEntry[]) =>
  JSON.stringify(servers, null, 2);

const fail = (message: string): never => {
  throw new Error(message);
};

/**
 * Parse the JSON the user typed into a server list, by the rules the gateway
 * applies to its own ({@link validateServers}).
 *
 * @param text the editor's contents
 * @param gatewayIds the ids the gateway serves, which a local entry may not reuse
 * @returns the parsed servers
 * @throws with a message naming the entry and field at fault
 */
export const parseServers = (
  text: string,
  gatewayIds: readonly string[] = []
): McpServerEntry[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    fail(`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  const servers = validateServers(parsed, gatewayIds);

  // Applying a list compares connections through serverUrl, which would throw after the list is installed
  servers.forEach((server, index) => {
    try {
      serverUrl(server);
    } catch {
      fail(`Server ${index + 1}: "url" is not a valid URL: ${server.url}`);
    }
  });
  return servers;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/mcp/model/config", () => {
    it("loads an entry that still names the server executor as a browser server", () => {
      const servers = parseServers(
        JSON.stringify([
          { id: "remote", url: "https://mcp.test/mcp", executor: "server" },
        ])
      );

      expect(servers).toEqual([
        {
          id: "remote",
          name: "remote",
          url: "https://mcp.test/mcp",
          enabled: true,
        },
      ]);
    });

    it("rejects a local entry whose id the gateway serves", () => {
      expect(() =>
        parseServers(
          JSON.stringify([{ id: "explorer", url: "https://mcp.test/mcp" }]),
          ["explorer"]
        )
      ).toThrow('id "explorer" is a server the gateway already serves');
    });

    it.each(["https://[", "//["])(
      "rejects a url that does not parse: %s",
      (url) => {
        expect(() =>
          parseServers(JSON.stringify([{ id: "remote", url }]))
        ).toThrow(`Server 1: "url" is not a valid URL: ${url}`);
      }
    );

    it("accepts a url relative to the page, as the gateway's are", () => {
      expect(
        parseServers(JSON.stringify([{ id: "local", url: "/api/mcp?x=1" }]))
      ).toHaveLength(1);
    });
  });
}
