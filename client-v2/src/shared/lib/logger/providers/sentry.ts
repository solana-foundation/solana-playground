import { reporter } from "../../reporter";
import type { LogProvider } from "../types";

/**
 * Initialises the reporter and sends it the entries marked `report` (see
 * `isReported`). Without a DSN it initialises nothing and sends nothing.
 */
export const sentryProvider = ({
  dsn,
  release,
  environment,
}: {
  dsn?: string;
  release?: string;
  environment?: string;
}): LogProvider => {
  if (!dsn) return { log: () => {} };

  reporter.init({ dsn, release, environment });

  return {
    log: (entry) => {
      if (entry.report) reporter.capture(entry);
    },
  };
};
