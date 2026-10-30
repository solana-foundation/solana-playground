// @ts-check
// The gateway's server list, composed from the catalogue (or `MCP_SERVERS`)
// and the environment. Pure: everything it reads comes in as arguments, so
// `api/mcp.mjs` passes `process.env` and a test passes a map.

import { MCP_CATALOGUE } from "./catalogue.mjs";
import { validateServers } from "./entry.mjs";

/** @typedef {import("./types").McpServerEntry} McpServerEntry */
/** @typedef {Readonly<Record<string, string | undefined>>} Env */

/** `${NAME}` or `${NAME:-default}`; an empty variable counts as unset, as `server-env.mjs` reads it */
const PLACEHOLDER = /\$\{([A-Za-z0-9_]+)(?::-([^}]*))?\}/g;

/**
 * A string with its placeholders filled: `unset` when one has neither a value
 * nor a default, `emptied` when one took an empty default.
 *
 * @typedef {{ kind: "filled" | "emptied", value: string } | { kind: "unset" }} Resolved
 */

/**
 * @param {string} text
 * @param {Env} env
 * @returns {Resolved}
 */
const resolve = (text, env) => {
  let unset = false;
  let emptied = false;
  const value = text.replace(PLACEHOLDER, (_, name, fallback) => {
    const filled = env[name] || fallback;
    if (filled === undefined) unset = true;
    else if (filled === "") emptied = true;
    return filled ?? "";
  });
  if (unset) return { kind: "unset" };
  return { kind: emptied ? "emptied" : "filled", value };
};

/**
 * Fill one entry's placeholders.
 *
 * A placeholder with no value drops the whole entry (`undefined`), wherever
 * it sits; a header or query value whose placeholder fell back to an empty
 * default (`${NAME:-}`) is left out rather than sent empty.
 *
 * @param {Record<string, unknown>} entry
 * @param {Env} env
 * @returns {Record<string, unknown> | undefined}
 */
const resolveEntry = (entry, env) => {
  /** @type {Record<string, unknown>} */
  const filled = {};
  for (const [key, value] of Object.entries(entry)) {
    if (typeof value === "string") {
      const resolved = resolve(value, env);
      if (resolved.kind === "unset") return undefined;
      filled[key] = resolved.value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      /** @type {Record<string, unknown>} */
      const map = {};
      for (const [k, v] of Object.entries(value)) {
        if (typeof v !== "string") {
          map[k] = v;
          continue;
        }
        const resolved = resolve(v, env);
        if (resolved.kind === "unset") return undefined;
        if (resolved.kind === "filled") map[k] = resolved.value;
      }
      filled[key] = map;
    } else {
      filled[key] = value;
    }
  }
  return filled;
};

/**
 * The servers the gateway offers this caller.
 *
 * @param {object} input
 * @param {Env} input.env what placeholders are filled from
 * @param {string} [input.servers] `MCP_SERVERS`: a JSON array in the entry format that replaces the catalogue
 * @param {boolean} input.signedIn whether the caller may see `signedIn` entries
 * @returns {McpServerEntry[]} enabled entries only, in the browser's format
 * @throws when `servers` is not JSON, or the composed list fails `validateServers`
 */
export const composeServers = ({ env, servers, signedIn }) => {
  /** @type {unknown} */
  const source = servers === undefined ? MCP_CATALOGUE : JSON.parse(servers);
  if (!Array.isArray(source)) {
    throw new Error("MCP_SERVERS must be a JSON array of servers.");
  }

  const resolved = source
    .filter((entry) => signedIn || entry?.signedIn !== true)
    // Anything that is not an object is left for validateServers to name
    .map((entry) =>
      entry && typeof entry === "object" ? resolveEntry(entry, env) : entry
    )
    .filter((entry) => entry !== undefined);

  return validateServers(resolved).filter((server) => server.enabled);
};
