import { createLogger } from "../../logger";
import type { TelemetryProvider } from "../types";

const log = createLogger("telemetry:event");

/** Writes each event to the logger at `debug`, to watch events in development */
export const logProvider = (): TelemetryProvider => ({
  send: ({ name, params, scope }) =>
    log.debug(name, {
      context: scope === undefined ? params : { ...params, scope },
    }),
});
