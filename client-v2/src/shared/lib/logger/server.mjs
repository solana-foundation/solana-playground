// The logger for `api/` and the slices' server-side `.mjs` modules; plain `.mjs` because the functions run in Node without a TypeScript build
import {
  reportServerProviderFailure,
  serverConsoleProvider,
} from "./providers/server-console.mjs";

export { serverConsoleProvider };

/**
 * @typedef {"error" | "warn" | "info" | "debug"} ServerLevel
 * @typedef {`${string}:${string}`} Namespace
 * @typedef {{
 *   ns: Namespace;
 *   level: ServerLevel;
 *   message?: string;
 *   error?: Error;
 *   context?: Record<string, unknown>;
 *   report: boolean;
 * }} ServerLogEntry
 * @typedef {{ log(entry: ServerLogEntry): void }} ServerLogProvider
 * @typedef {{ ns?: Namespace; report?: boolean; context?: Record<string, unknown> }} ServerLogOptions
 */

// Read on every call: module-level loggers exist before `initServerLogger` runs
/** @type {ServerLogProvider[]} */
let providers = [serverConsoleProvider()];

/**
 * Replaces the providers every server logger sends to, including loggers created earlier.
 *
 * @param {{ providers: ServerLogProvider[] }} options
 */
export const initServerLogger = (options) => {
  providers = options.providers;
};

/** Test seam: back to the console-only default */
export const resetServerLogger = () => {
  providers = [serverConsoleProvider()];
};

/** @param {unknown} value */
const toError = (value) =>
  value instanceof Error ? value : new Error(String(value), { cause: value });

/** @param {ServerLogEntry} entry */
const send = (entry) => {
  for (const provider of providers) {
    try {
      provider.log(entry);
    } catch (error) {
      reportServerProviderFailure(error, entry);
    }
  }
};

/**
 * A logger whose entries carry `ns` unless a call passes its own. Only `error`
 * and `warn` take `report: true`, which sends the entry to Sentry where it is on.
 *
 * @example
 * ```ts
 * const log = createServerLogger("api:projects");
 * log.error(e, { report: true });
 * ```
 *
 * @param {Namespace} ns
 */
export const createServerLogger = (ns) => {
  /**
   * @param {ServerLevel} level
   * @param {ServerLogOptions | undefined} options
   * @param {Pick<ServerLogEntry, "message" | "error">} fields
   * @returns {ServerLogEntry}
   */
  const entry = (level, options, fields) => ({
    ns: options?.ns ?? ns,
    level,
    ...fields,
    context: options?.context,
    report: (level === "error" || level === "warn") && options?.report === true,
  });

  return {
    /** @param {unknown} error @param {ServerLogOptions} [options] */
    error: (error, options) =>
      send(entry("error", options, { error: toError(error) })),
    /** @param {string} message @param {ServerLogOptions} [options] */
    warn: (message, options) => send(entry("warn", options, { message })),
    /** @param {string} message @param {Omit<ServerLogOptions, "report">} [options] */
    info: (message, options) => send(entry("info", options, { message })),
    /** @param {string} message @param {Omit<ServerLogOptions, "report">} [options] */
    debug: (message, options) => send(entry("debug", options, { message })),
  };
};

/** @type {Record<ServerLevel, "error" | "warning" | "info" | "debug">} */
const SENTRY_LEVEL = {
  error: "error",
  warn: "warning",
  info: "info",
  debug: "debug",
};

/**
 * Sends the entries marked `report` to Sentry, tagged `ns`. Takes the loaded
 * SDK, so `shared` never imports `@sentry/node`.
 *
 * @param {Pick<typeof import("@sentry/node"), "captureException" | "captureMessage">} Sentry
 * @returns {ServerLogProvider}
 */
export const sentryServerProvider = (Sentry) => ({
  log: (entry) => {
    if (!entry.report) return;
    // Sentry titles an exception by its own message, so the tag is what tells modules apart
    const scope = {
      level: SENTRY_LEVEL[entry.level],
      tags: { ns: entry.ns },
      extra: entry.context,
    };
    if (entry.error) Sentry.captureException(entry.error, scope);
    else Sentry.captureMessage(`[${entry.ns}] ${entry.message ?? ""}`, scope);
  },
});
