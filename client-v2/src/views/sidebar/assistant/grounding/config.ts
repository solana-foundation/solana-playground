import type { McpServerEntry } from "./types";

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
 * confusingly — a duplicate id is rejected by the API mid-turn, and a blank
 * credential on an enabled server reads as "MCP is broken" rather than
 * "you left a field empty".
 *
 * @param text the editor's contents
 * @returns the parsed servers
 * @throws with a message naming the entry and field at fault
 */
export const parseServers = (text: string): McpServerEntry[] => {
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
    if (seen.has(id as string)) {
      fail(`${where}: duplicate id "${id}" — the API rejects repeated names.`);
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

    return {
      id: id as string,
      name: (name as string | undefined) ?? (id as string),
      url: (url as string).trim(),
      enabled: isEnabled,
      ...(authToken ? { authToken: authToken as string } : {}),
      ...(queryParams ? { queryParams } : {}),
      ...(headers ? { headers } : {}),
    };
  });
};
