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

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeAll, beforeEach, afterEach } =
    import.meta.vitest;
  describe("shared/lib/logger/logger", () => {
    let memoryProvider: typeof import("./providers/memory").memoryProvider;
    beforeAll(async () => {
      ({ memoryProvider } = await import("./providers/memory"));
    });
    // Created at import, before any `initLogger` in this file runs
    const early = createLogger("persistence:sync");

    let logged: ReturnType<typeof memoryProvider>;

    beforeEach(() => {
      logged = memoryProvider();
      initLogger({ providers: [logged] });
    });

    afterEach(() => resetLogger());

    describe("namespace", () => {
      it.each([
        [
          "the default",
          () => Logger.warn("clipboard unavailable"),
          "app:common",
        ],
        [
          "a per-call option",
          () => Logger.error(new Error("x"), { ns: "wallet:connect" }),
          "wallet:connect",
        ],
        [
          "a bound logger",
          () => createLogger("auth:popup").error(new Error("x")),
          "auth:popup",
        ],
        [
          "a per-call option over a bound logger",
          () => createLogger("auth:popup").warn("x", { ns: "auth:session" }),
          "auth:session",
        ],
      ])("should record %s", (_, act, ns) => {
        act();

        expect(logged.entries.map((entry) => entry.ns)).toEqual([ns]);
      });
    });

    it("should send entries from a logger created before initLogger to the later providers", () => {
      early.error(new Error("push rejected"));

      expect(logged.entries).toHaveLength(1);
    });

    it("should keep a thrown non-Error value as the cause", () => {
      Logger.error("timeout");

      const { error } = logged.entries[0];
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toBe("timeout");
      expect(error?.cause).toBe("timeout");
    });

    // The rule itself is covered by the in-source tests of `severity.ts`; this proves the logger applies it
    it("should mark an entry reported by its level's rule, not only by the option", () => {
      Logger.panic(new Error("x"));

      expect(logged.entries[0].report).toBe(true);
    });

    it("should keep delivering to other providers when one throws", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const broken = {
        log: () => {
          throw new Error("broken");
        },
      };
      initLogger({ providers: [broken, logged] });

      Logger.warn("still delivered");

      expect(logged.entries).toHaveLength(1);
      // eslint-disable-next-line no-console -- asserts on console.error, and no-console does not exclude in-source test blocks
      expect(console.error).toHaveBeenCalledWith(
        "[logger:provider] a log provider threw",
        expect.any(Error)
      );
    });
  });
}
