import type { Level } from "./severity";

export type { Level } from "./severity";

/** `<slice>:<module>`, such as `persistence:sync` */
export type Namespace = `${string}:${string}`;

export interface LogEntry {
  ns: Namespace;
  level: Level;
  message?: string;
  error?: Error;
  context?: Record<string, unknown>;
  /** Reaches error tracking, as decided by `isReported` */
  report: boolean;
  /** Came from a global handler, not from a `catch` */
  unhandled: boolean;
}

export interface LogProvider {
  log(entry: LogEntry): void;
  /**
   * `false` keeps the reports made before the first `initLogger` from being
   * delivered to this provider again once it starts. The summary of reports
   * dropped past the buffer is never printed before, so it still arrives
   */
  replay?: boolean;
}

export interface LogOptions {
  /** Overrides the logger's namespace for this entry */
  ns?: Namespace;
  /** Send an `error` or `warn` entry to error tracking */
  report?: boolean;
  context?: Record<string, unknown>;
}
