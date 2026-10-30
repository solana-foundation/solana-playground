// @ts-check
// The shape of an MCP server entry, checked once for both of its readers: the
// browser's `parseServers` (`config.ts`) and the gateway's `composeServers`
// (`compose.mjs`). `.mjs` so Node imports it directly; `allowJs` lets the
// TypeScript side import the same file (see `shared/lib/json-rpc.mjs`).

import { isProtectionProvider, PROTECTION_PROVIDERS } from "./protection.mjs";

/** @typedef {import("./types").McpServerEntry} McpServerEntry */
/** @typedef {import("./types").McpProtection} McpProtection */

/** The id prefixes tool names, which every provider restricts to these characters */
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * @param {string} message
 * @returns {never}
 */
const fail = (message) => {
  throw new Error(message);
};

/**
 * Read an optional `Record<string, string>`, rejecting anything else.
 *
 * @param {unknown} value
 * @param {string} where
 * @returns {Record<string, string> | undefined}
 */
const readStringMap = (value, where) => {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${where} must be an object of strings.`);
  }

  const entries = Object.entries(
    /** @type {Record<string, unknown>} */ (value)
  );
  for (const [key, item] of entries) {
    if (typeof item !== "string") {
      fail(`${where}."${key}" must be a string.`);
    }
  }
  return /** @type {Record<string, string>} */ (Object.fromEntries(entries));
};

/**
 * Read an optional bot-protection bypass.
 *
 * @param {unknown} value
 * @param {string} where
 * @returns {McpProtection | undefined} undefined when absent or when its secret is, which is how an unset `${NAME:-}` arrives from the catalogue
 */
const readProtection = (value, where) => {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${where} must be an object with "provider" and "secret".`);
  }

  const { provider, secret } = /** @type {Record<string, unknown>} */ (value);
  if (typeof provider !== "string" || !isProtectionProvider(provider)) {
    fail(
      `${where}.provider must be one of: ` +
        `${Object.keys(PROTECTION_PROVIDERS).join(", ")}.`
    );
  }
  if (secret === undefined) return undefined;
  if (typeof secret !== "string" || !secret.trim()) {
    fail(`${where}.secret is empty — fill it or remove "protection".`);
  }
  return { provider, secret };
};

/**
 * Check a parsed server list and fill in its defaults.
 *
 * Strict about what fails *later* and confusingly: a duplicate id makes one
 * server's tools replace the other's, and a blank credential on an enabled
 * server reads as "MCP is broken" rather than "you left a field empty".
 *
 * @param {unknown} parsed the JSON, already parsed
 * @param {readonly string[]} [reservedIds] ids another list owns, which an entry may not reuse
 * @returns {McpServerEntry[]}
 * @throws with a message naming the entry and field at fault
 */
export const validateServers = (parsed, reservedIds = []) => {
  if (!Array.isArray(parsed)) fail("The config must be an array of servers.");

  const servers = /** @type {unknown[]} */ (parsed);
  const seen = new Set();

  return servers.map((raw, index) => {
    const where = `Server ${index + 1}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      fail(`${where} must be an object.`);
    }

    const entry = /** @type {Record<string, unknown>} */ (raw);
    // An `executor` key, from before every server ran in the browser, is ignored like any unknown key
    const { id, name, url, enabled, authToken } = entry;

    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      fail(`${where}: "id" must be letters, digits, dashes or underscores.`);
    }
    // Tool names are prefixed with the id, so one server's tools would replace the other's
    if (seen.has(id)) {
      fail(
        `${where}: duplicate id "${id}". Two servers with one id would have ` +
          "one server's tools replace the other's."
      );
    }
    if (reservedIds.includes(id)) {
      fail(
        `${where}: id "${id}" is a server the gateway already serves. Pick ` +
          "another id, or one server's tools would replace the other's."
      );
    }
    seen.add(id);

    if (typeof url !== "string" || !url.trim()) {
      fail(`${where}: "url" is required.`);
    }
    // https for a remote server; a leading `/` is our own gateway
    const target = url.trim();
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
    const protection = readProtection(entry.protection, `${where}.protection`);
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
      id,
      name: name ?? id,
      url: target,
      enabled: isEnabled,
      ...(authToken ? { authToken } : {}),
      ...(queryParams ? { queryParams } : {}),
      ...(headers ? { headers } : {}),
      ...(protection ? { protection } : {}),
    };
  });
};
