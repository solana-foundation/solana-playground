// @ts-check
// The catalogue as one caller sees it. Pure: the environment and the override
// come in as arguments, so a route passes `process.env` and a test a map. It
// knows `kind`, `id`, and `signedIn` only; each slice checks its own kind's
// fields.

import { SOURCES_CATALOGUE } from "../../config/sources.mjs";

/** @typedef {Readonly<Record<string, string | undefined>>} Env */
/** @typedef {Record<string, unknown>} ComposedEntry an entry with its placeholders filled, `kind` and `signedIn` removed */

/** The kinds of source, each validated by its own slice */
const KINDS = /** @type {const} */ (["mcp", "skill"]);

/** `${NAME}` or `${NAME:-default}`; an empty variable counts as unset, as `server-env.mjs` reads it */
// eslint-disable-next-line security/detect-unsafe-regex -- linear: `:-` opens the default and `[^}]` stops at its close
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
 * it sits; a value inside an object whose placeholder fell back to an empty
 * default (`${NAME:-}`) is left out rather than sent empty.
 *
 * @param {Record<string, unknown>} entry
 * @param {Env} env
 * @returns {ComposedEntry | undefined}
 */
const resolveEntry = (entry, env) => {
  /** @type {ComposedEntry} */
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
 * Read the override, or take the shipped catalogue.
 *
 * @param {string | undefined} override
 * @returns {{ entries: unknown[], label: string }} `label` names the list in errors
 */
const sourceList = (override) => {
  if (override === undefined) {
    return { entries: [...SOURCES_CATALOGUE], label: "SOURCES_CATALOGUE" };
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(override);
  } catch (e) {
    throw new Error(
      `SOURCES is not JSON: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("SOURCES must be a JSON array of sources.");
  }
  return { entries: parsed, label: "SOURCES" };
};

/**
 * Check what the composer owns, `kind` and `id`, on the whole list, so a
 * mistake fails for every caller rather than only the one who sees the entry.
 *
 * @param {unknown[]} entries
 * @param {string} label
 * @returns {Array<Record<string, unknown> & { kind: "mcp" | "skill", id: string }>}
 */
const checkEntries = (entries, label) => {
  const seen = new Set();
  return entries.map((raw, index) => {
    const where = `${label} entry ${index + 1}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`${where} must be an object.`);
    }
    const entry = /** @type {Record<string, unknown>} */ (raw);
    if (typeof entry.id !== "string" || !entry.id) {
      throw new Error(`${where}: "id" must be a non-empty string.`);
    }
    if (!KINDS.includes(/** @type {never} */ (entry.kind))) {
      throw new Error(
        `${where} ("${entry.id}"): "kind" must be one of: ${KINDS.join(", ")}.`
      );
    }
    // One id names one source: the tab, the selection, and the tools key on it
    if (seen.has(entry.id)) {
      throw new Error(`${where}: duplicate id "${entry.id}".`);
    }
    seen.add(entry.id);
    return /** @type {Record<string, unknown> & { kind: "mcp" | "skill", id: string }} */ (
      entry
    );
  });
};

/**
 * The catalogue this caller is offered, by kind.
 *
 * @param {object} input
 * @param {Env} input.env what placeholders are filled from
 * @param {string} [input.override] `SOURCES`: a JSON array in the catalogue's format that replaces it
 * @param {boolean} input.signedIn whether the caller may see `signedIn` entries
 * @returns {Record<"mcp" | "skill", ComposedEntry[]>}
 * @throws when the override is not a JSON array, or an entry has no id, an unknown kind, or a duplicate id before or after its placeholders are filled
 */
export const composeCatalogue = ({ env, override, signedIn }) => {
  const { entries, label } = sourceList(override);

  /** @type {Record<"mcp" | "skill", ComposedEntry[]>} */
  const byKind = { mcp: [], skill: [] };
  // Checked again once filled: `${A}` and `${B}` pass `checkEntries` and may name one id
  const filledIds = new Set();
  for (const [index, entry] of checkEntries(entries, label).entries()) {
    if (entry.signedIn === true && !signedIn) continue;
    const { kind, signedIn: _signedIn, ...fields } = entry;
    const filled = resolveEntry(fields, env);
    if (!filled) continue;
    if (filledIds.has(filled.id)) {
      throw new Error(
        `${label} entry ${index + 1}: duplicate id "${filled.id}".`
      );
    }
    filledIds.add(filled.id);
    byKind[kind].push(filled);
  }
  return byKind;
};
