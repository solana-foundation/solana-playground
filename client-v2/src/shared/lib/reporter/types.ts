import type { LogEntry } from "../logger/types";

export interface ReporterConfig {
  dsn: string;
  release?: string;
  environment?: string;
  /** The share of page loads and navigations traced, from 0 to 1; the browser's alone, since the API functions keep their own rate */
  tracesSampleRate: number;
}

/** A message a user writes to the team, with what it was sent from */
export interface Feedback {
  message: string;
  /** The user's contact, shown as the feedback's name */
  name?: string;
  /** Where in the product the feedback was written */
  source: string;
  tags: Record<string, string | number>;
}

/** What reaches the team: the log entries marked `report`, and user feedback */
export interface Reporter {
  /** Whether this build bundles a reporting SDK; `sentryEnabled` decides it */
  carried: boolean;
  init(config: ReporterConfig): void;
  capture(entry: LogEntry): void;
  /** Keeps an entry as a breadcrumb, the trail later reports carry */
  trail(entry: LogEntry): void;
  /** Resolves when the feedback is accepted; rejects when it is not delivered */
  sendFeedback(feedback: Feedback): Promise<void>;
}
