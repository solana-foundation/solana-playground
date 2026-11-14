import { reporter } from "../../reporter";
import { atLeast } from "../severity";
import type { LogProvider } from "../types";

/**
 * Initialises the reporter and sends it the entries marked `report` (see
 * `isReported`), and every entry at `warn` or above as a breadcrumb: the trail
 * a later report carries, which production's console showed before. Without a
 * DSN it initialises nothing and sends nothing.
 */
export const sentryProvider = ({
  dsn,
  release,
  environment,
  tracesSampleRate,
}: {
  dsn?: string;
  release?: string;
  environment?: string;
  tracesSampleRate: number;
}): LogProvider => {
  if (!dsn) return { log: () => {} };

  reporter.init({ dsn, release, environment, tracesSampleRate });

  return {
    log: (entry) => {
      if (entry.report) reporter.capture(entry);
      // After the capture, so an entry is not a breadcrumb of its own report
      if (atLeast(entry.level, "warn")) reporter.trail(entry);
    },
  };
};
