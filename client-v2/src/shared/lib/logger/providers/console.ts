import { observabilityEnv } from "../../../config/client-env";
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
