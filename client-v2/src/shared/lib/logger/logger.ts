import { consoleProvider, reportProviderFailure } from "./providers/console";
import type { Level } from "./severity";
import { isReported } from "./severity";
import type { LogEntry, LogOptions, LogProvider, Namespace } from "./types";

// Read on every call: module-level loggers exist before `initLogger` runs
let providers: LogProvider[] = [consoleProvider()];

/** Bounds the reports kept before `initLogger`, so a never-initialised app cannot grow it */
const BUFFER_LIMIT = 50;

let initialised = false;
// Reports made before the first `initLogger`, such as during module import
const pending: LogEntry[] = [];
let overflowed = false;

/** Keeps a thrown non-Error value as `cause`, so it is not lost */
export const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value), { cause: value });

const deliver = (entry: LogEntry, to: LogProvider[]) => {
  for (const provider of to) {
    try {
      provider.log(entry);
    } catch (error) {
      reportProviderFailure(error);
    }
  }
};

const send = (entry: LogEntry) => {
  deliver(entry, providers);
  if (!initialised && entry.report) keepPending(entry);
};

const keepPending = (entry: LogEntry) => {
  if (pending.length < BUFFER_LIMIT) {
    pending.push(entry);
  } else if (!overflowed) {
    overflowed = true;
    // Not reported, so it is not buffered behind the reports it is about
    send({
      ns: "logger:buffer",
      level: "warn",
      message: "reports dropped: the logger is not initialised",
      context: { kept: BUFFER_LIMIT, firstDropped: entry.ns },
      report: false,
      unhandled: false,
    });
  }
};

/**
 * Replaces the providers every logger sends to, including loggers created
 * earlier. The first call also delivers, in order, the reports made before
 * it to every provider not marked `replay: false`; later calls replay
 * nothing, so pass the final provider set on the first call.
 */
export const initLogger = (options: { providers: LogProvider[] }) => {
  providers = options.providers;
  if (initialised) return;
  initialised = true;
  const replayTo = providers.filter((provider) => provider.replay !== false);
  for (const entry of pending.splice(0)) deliver(entry, replayTo);
};

/** Test seam: back to the console-only default, before `initLogger` */
export const resetLogger = () => {
  providers = [consoleProvider()];
  initialised = false;
  pending.length = 0;
  overflowed = false;
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

    describe("before initLogger", () => {
      beforeEach(() => {
        resetLogger();
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
      });
      afterEach(() => vi.restoreAllMocks());

      it("should deliver a reported entry once, after the first initLogger", () => {
        early.error(new Error("bad tutorial definition"), { report: true });

        initLogger({ providers: [logged] });
        initLogger({ providers: [logged] });

        expect(logged.entries).toMatchObject([
          { ns: "persistence:sync", report: true },
        ]);
      });

      it("should replay the kept reports in the order they were made", () => {
        early.error(new Error("first"), { report: true });
        early.error(new Error("second"), { report: true });

        initLogger({ providers: [logged] });

        expect(logged.entries.map((entry) => entry.error?.message)).toEqual([
          "first",
          "second",
        ]);
      });

      it("should not replay a report made after the first initLogger", () => {
        initLogger({ providers: [memoryProvider()] });
        early.error(new Error("x"), { report: true });

        initLogger({ providers: [logged] });

        expect(logged.entries).toEqual([]);
      });

      it("should drop the kept reports on resetLogger", () => {
        early.error(new Error("x"), { report: true });

        resetLogger();
        initLogger({ providers: [logged] });

        expect(logged.entries).toEqual([]);
      });

      it("should not replay an entry that was not reported", () => {
        early.warn("not reported");

        initLogger({ providers: [logged] });

        expect(logged.entries).toEqual([]);
      });

      it("should not replay to a provider that already printed the entry", () => {
        const printed = vi.spyOn(console, "error");
        early.error(new Error("x"), { report: true });
        printed.mockClear();

        initLogger({ providers: [consoleProvider(), logged] });

        expect(printed).not.toHaveBeenCalled();
        expect(logged.entries).toHaveLength(1);
      });

      it("should keep at most BUFFER_LIMIT reports and warn once about the rest", () => {
        const warned = vi.spyOn(console, "warn");
        for (let i = 0; i <= BUFFER_LIMIT + 1; i++) {
          early.error(new Error(`e${i}`), { report: true });
        }

        initLogger({ providers: [logged] });

        expect(logged.entries).toHaveLength(BUFFER_LIMIT);
        expect(warned).toHaveBeenCalledTimes(1);
        expect(warned).toHaveBeenCalledWith(
          "[logger:buffer]",
          "reports dropped: the logger is not initialised",
          { kept: BUFFER_LIMIT, firstDropped: "persistence:sync" }
        );
      });
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
      const printed = vi.spyOn(console, "error").mockImplementation(() => {});
      const broken = {
        log: () => {
          throw new Error("broken");
        },
      };
      initLogger({ providers: [broken, logged] });

      Logger.warn("still delivered");

      expect(logged.entries).toHaveLength(1);
      expect(printed).toHaveBeenCalledWith(
        "[logger:provider] a log provider threw",
        expect.any(Error)
      );
    });
  });
}
