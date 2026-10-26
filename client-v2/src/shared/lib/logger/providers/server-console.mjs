/** @typedef {import("../server.mjs").ServerLogEntry} ServerLogEntry */

/** @type {Record<ServerLogEntry["level"], "error" | "warn" | "info" | "debug">} */
const METHOD = {
  error: "error",
  warn: "warn",
  info: "info",
  debug: "debug",
};

/**
 * An error as a plain object: its own properties (`pg` adds `constraint`,
 * `detail` and more), `message`, `code`, `stack`, and an Error cause the same way, once each.
 *
 * @param {Error} error
 * @param {Set<unknown>} [seen]
 * @returns {Record<string, unknown>}
 */
const fieldsOf = (error, seen = new Set([error])) => {
  const { cause } = error;
  const nested = cause instanceof Error && !seen.has(cause);
  if (nested) seen.add(cause);
  return {
    ...Object.fromEntries(Object.entries(error)),
    message: error.message,
    code: /** @type {{ code?: unknown }} */ (error).code,
    stack: error.stack,
    cause: nested ? fieldsOf(cause, seen) : cause,
  };
};

/**
 * Prints every entry with the matching `console` method into Vercel's function
 * log. An error goes out field by field, because that log reduces an `Error`
 * to its `message` and `stack` and drops its own properties.
 *
 * @returns {import("../server.mjs").ServerLogProvider}
 */
export const serverConsoleProvider = () => ({
  log: ({ ns, level, message, error, context }) => {
    /** @type {unknown[]} */
    const args = [`[${ns}]`];
    if (message !== undefined) args.push(message);
    if (error !== undefined) args.push(fieldsOf(error));
    if (context !== undefined) args.push(context);
    console[METHOD[level]](...args);
  },
});

/**
 * The one place a failing provider is reported: logging it through the logger could loop.
 *
 * @param {unknown} error
 * @param {ServerLogEntry} entry the entry the provider failed on
 */
export const reportServerProviderFailure = (error, entry) =>
  console.error(
    "[logger:provider] a log provider threw",
    {
      ns: entry.ns,
      level: entry.level,
      message: entry.message ?? entry.error?.message,
    },
    error
  );
