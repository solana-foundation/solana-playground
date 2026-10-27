import { observabilityEnv } from "@/shared/config/client-env";
import { atLeast, isLevel } from "../severity";
import type { Level } from "../severity";
import type { LogEntry, LogProvider } from "../types";

const METHOD: Record<Level, "error" | "warn" | "info" | "debug"> = {
  panic: "error",
  error: "error",
  warn: "warn",
  info: "info",
  debug: "debug",
};

/** `REACT_APP_LOG_LEVEL` when valid; else `warn` in production builds and `debug` elsewhere */
export const defaultLevel = (): Level => {
  const configured = observabilityEnv().LOG_LEVEL;
  if (isLevel(configured)) return configured;
  return process.env.NODE_ENV === "production" ? "warn" : "debug";
};

const argsOf = ({ ns, message, error, context }: LogEntry): unknown[] => {
  const args: unknown[] = [`[${ns}]`];
  if (message !== undefined) args.push(message);
  if (error !== undefined) args.push(error);
  if (context !== undefined) args.push(context);
  return args;
};

/** Prints entries at or above `level` with the matching `console` method */
export const consoleProvider = ({
  level = defaultLevel(),
}: { level?: Level } = {}): LogProvider => ({
  log: (entry) => {
    if (!atLeast(entry.level, level)) return;
    console[METHOD[entry.level]](...argsOf(entry));
  },
});

/** The one place a failing provider is reported: logging it through the logger could loop */
export const reportProviderFailure = (error: unknown) =>
  console.error("[logger:provider] a log provider threw", error);

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeEach, afterEach } = import.meta
    .vitest;

  describe("shared/lib/logger/providers/console", () => {
    const entry = (
      fields: Pick<LogEntry, "level"> & Partial<LogEntry>
    ): LogEntry => ({
      ns: fields.ns ?? "persistence:sync",
      level: fields.level,
      message: fields.message ?? "push rejected",
      error: fields.error,
      context: fields.context,
      report: false,
      unhandled: false,
    });

    beforeEach(() => {
      for (const method of ["error", "warn", "info", "debug"] as const) {
        vi.spyOn(console, method).mockImplementation(() => {});
      }
    });

    it.each([
      ["panic", "error"],
      ["error", "error"],
      ["warn", "warn"],
      ["info", "info"],
      ["debug", "debug"],
    ] as const)("should print %s with console.%s", (level, method) => {
      consoleProvider({ level: "debug" }).log(entry({ level }));

      expect(console[method]).toHaveBeenCalledWith(
        "[persistence:sync]",
        "push rejected"
      );
    });

    it("should print only entries at or above its threshold", () => {
      const provider = consoleProvider({ level: "warn" });

      provider.log(entry({ level: "info", message: "hidden" }));
      provider.log(entry({ level: "warn", message: "shown" }));

      expect(console.info).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith("[persistence:sync]", "shown");
    });

    describe("defaultLevel", () => {
      afterEach(() => vi.unstubAllEnvs());

      it.each([
        ["production", undefined, "warn"],
        ["development", undefined, "debug"],
        ["production", "info", "info"],
        ["production", "verbose", "warn"],
      ])(
        "should resolve NODE_ENV=%s and REACT_APP_LOG_LEVEL=%s to %s",
        (nodeEnv, configured, expected) => {
          vi.stubEnv("NODE_ENV", nodeEnv);
          vi.stubEnv("REACT_APP_LOG_LEVEL", configured);

          expect(defaultLevel()).toBe(expected);
        }
      );
    });
  });
}
