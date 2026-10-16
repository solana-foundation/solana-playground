import type { LogEntry, LogProvider } from "../types";

/** Records entries for a test to assert on */
export const memoryProvider = (): LogProvider & { entries: LogEntry[] } => {
  const entries: LogEntry[] = [];
  return { entries, log: (entry) => entries.push(entry) };
};
