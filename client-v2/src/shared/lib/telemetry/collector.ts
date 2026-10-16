import { createLogger } from "../logger";
import type { TelemetryEvent, TelemetryProvider } from "./types";

const log = createLogger("telemetry:collector");

/** Bounds the events kept before `initTelemetry`, so a never-initialised app cannot grow it */
export const BUFFER_LIMIT = 100;

let providers: TelemetryProvider[] | undefined;
const buffer: TelemetryEvent[] = [];
let overflowed = false;

const deliver = (event: TelemetryEvent) => {
  for (const provider of providers ?? []) {
    try {
      provider.send(event);
    } catch (error) {
      // A broken provider must not break the action that was being tracked
      log.error(error, { report: true, context: { event: event.name } });
    }
  }
};

export const emit = (event: TelemetryEvent) => {
  if (providers) {
    deliver(event);
  } else if (buffer.length < BUFFER_LIMIT) {
    buffer.push(event);
  } else if (!overflowed) {
    overflowed = true;
    log.warn("events dropped: telemetry is not initialised", {
      context: { kept: BUFFER_LIMIT, firstDropped: event.name },
    });
  }
};

/** Sets where events go and delivers everything tracked before this call */
export const initTelemetry = (options: { providers: TelemetryProvider[] }) => {
  providers = options.providers;
  buffer.splice(0).forEach(deliver);
};

/** Test seam: back to the state before `initTelemetry` */
export const resetTelemetry = () => {
  providers = undefined;
  buffer.length = 0;
  overflowed = false;
};
