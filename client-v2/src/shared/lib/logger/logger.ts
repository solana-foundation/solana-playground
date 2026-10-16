import { consoleProvider, reportProviderFailure } from "./providers/console";
import { isReported } from "./severity";
import type { Level } from "./severity";
import type { LogEntry, LogOptions, LogProvider, Namespace } from "./types";

// Read on every call: module-level loggers exist before `initLogger` runs
let providers: LogProvider[] = [consoleProvider()];

/** Replaces the providers every logger sends to, including loggers created earlier */
export const initLogger = (options: { providers: LogProvider[] }) => {
  providers = options.providers;
};

/** Test seam: back to the console-only default */
export const resetLogger = () => {
  providers = [consoleProvider()];
};

/** Keeps a thrown non-Error value as `cause`, so it is not lost */
export const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value), { cause: value });

const send = (entry: LogEntry) => {
  for (const provider of providers) {
    try {
      provider.log(entry);
    } catch (error) {
      reportProviderFailure(error);
    }
  }
};

type ErrorOptions = LogOptions & { unhandled?: boolean };

export interface Log {
  panic(error: unknown, options?: Omit<ErrorOptions, "report">): void;
  error(error: unknown, options?: LogOptions): void;
  warn(message: string, options?: LogOptions): void;
  info(message: string, options?: Omit<LogOptions, "report">): void;
  debug(message: string, options?: Omit<LogOptions, "report">): void;
}

/**
 * A logger whose entries carry `ns` unless a call passes its own.
 *
 * @example
 * ```ts
 * const log = createLogger("persistence:sync");
 * log.error(error, { report: true, context: { projectId } });
 * ```
 */
export const createLogger = (ns: Namespace): Log => {
  const entry = (
    level: Level,
    options: ErrorOptions | undefined,
    fields: Pick<LogEntry, "message" | "error">
  ): LogEntry => ({
    ns: options?.ns ?? ns,
    level,
    ...fields,
    context: options?.context,
    report: isReported(level, options?.report === true),
    unhandled: options?.unhandled === true,
  });

  return {
    panic: (error, options) =>
      send(entry("panic", options, { error: toError(error) })),
    error: (error, options) =>
      send(entry("error", options, { error: toError(error) })),
    warn: (message, options) => send(entry("warn", options, { message })),
    info: (message, options) => send(entry("info", options, { message })),
    debug: (message, options) => send(entry("debug", options, { message })),
  };
};

/** For one-off and legacy calls; a slice that logs often binds its own with `createLogger` */
export const Logger = createLogger("app:common");
