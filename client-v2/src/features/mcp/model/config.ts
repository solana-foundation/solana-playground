import type { McpServerEntry } from "./types";

/**
 * Extra MCP servers, added from the client.
 *
 * **Not the source of truth.** The gateway (`api/mcp.mjs`) owns the list and
 * the panel asks it at startup, so enabling an upstream is a deploy plus an
 * env var rather than a client change — that is how an operator turns Explorer
 * on without shipping anything. Why the gateway withholds Explorer from a
 * request is `explorerWithheld` in `api/mcp.mjs`, with `EXPLORER_HINTS` saying
 * what to do about each reason.
 *
 * This list is only for servers wanted *in addition*: something CORS-open a
 * page can reach directly. Empty by default, and deliberately not a mirror of
 * what the gateway serves, since two lists would disagree.
 */
export const LOCAL_MCP_SERVERS: McpServerEntry[] = [];

/** The id prefixes tool names, which every provider restricts to these characters */
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** A server's URL with its `queryParams` folded in */
export const serverUrl = (server: McpServerEntry) => {
  // Relative for our own gateway (`/api/mcp?...`), absolute for anything else
  const url = new URL(server.url.trim(), window.location.origin);
  for (const [key, value] of Object.entries(server.queryParams ?? {})) {
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

/** Read an optional `Record<string, string>`, rejecting anything else */
const readStringMap = (
  value: unknown,
  where: string
): Record<string, string> | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${where} must be an object of strings.`);
  }

  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, item] of entries) {
    if (typeof item !== "string") {
      fail(`${where}."${key}" must be a string.`);
    }
  }
  return Object.fromEntries(entries) as Record<string, string>;
};

/**
 * Parse the JSON the user typed into a server list.
 *
 * Validation is deliberately strict about the things that fail *later* and
 * confusingly — a duplicate id makes one server's tools replace the other's, and a blank
 * credential on an enabled server reads as "MCP is broken" rather than
 * "you left a field empty".
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

  if (!Array.isArray(parsed)) fail("The config must be an array of servers.");

  const servers = parsed as unknown[];
  const seen = new Set<string>();

  return servers.map((raw, index) => {
    const where = `Server ${index + 1}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      fail(`${where} must be an object.`);
    }

    const entry = raw as Record<string, unknown>;
    // An `executor` key, from before every server ran in the browser, is ignored like any unknown key
    const { id, name, url, enabled, authToken } = entry;

    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      fail(`${where}: "id" must be letters, digits, dashes or underscores.`);
    }
    // Tool names are prefixed with the id, so one server's tools would replace the other's
    if (seen.has(id as string)) {
      fail(
        `${where}: duplicate id "${id}". Two servers with one id would have ` +
          "one server's tools replace the other's."
      );
    }
    if (gatewayIds.includes(id as string)) {
      fail(
        `${where}: id "${id}" is a server the gateway already serves. Pick ` +
          "another id, or one server's tools would replace the other's."
      );
    }
    seen.add(id as string);

    if (typeof url !== "string" || !url.trim()) {
      fail(`${where}: "url" is required.`);
    }
    // https for a remote server; a leading `/` is our own gateway
    const target = (url as string).trim();
    if (!target.startsWith("https://") && !target.startsWith("/")) {
      fail(`${where}: "url" must start with https:// or / for the gateway.`);
    }
    if (name !== undefined && typeof name !== "string") {
      fail(`${where}: "name" must be a string.`);
    }
    if (enabled !== undefined && typeof enabled !== "boolean") {
      fail(`${where}: "enabled" must be true or false.`);
    }
    if (authToken !== undefined && typeof authToken !== "string") {
      fail(`${where}: "authToken" must be a string.`);
    }

    const queryParams = readStringMap(
      entry.queryParams,
      `${where}.queryParams`
    );
    const headers = readStringMap(entry.headers, `${where}.headers`);
    const isEnabled = enabled !== false;

    // An enabled server with a blank credential looks like a broken server
    if (isEnabled) {
      for (const [key, value] of Object.entries(queryParams ?? {})) {
        if (!value.trim()) {
          fail(`${where}: queryParams."${key}" is empty — fill it or disable.`);
        }
      }
    }

    const server: McpServerEntry = {
      id: id as string,
      name: (name as string | undefined) ?? (id as string),
      url: target,
      enabled: isEnabled,
      ...(authToken ? { authToken: authToken as string } : {}),
      ...(queryParams ? { queryParams } : {}),
      ...(headers ? { headers } : {}),
    };

    // Applying a list compares connections through serverUrl, which would throw after the list is installed
    try {
      serverUrl(server);
    } catch {
      fail(`${where}: "url" is not a valid URL: ${target}`);
    }
    return server;
  });
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
