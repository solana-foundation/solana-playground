import type { TelemetryEvent, TelemetryProvider } from "../types";

/** Records events for a test to assert on */
export const memoryProvider = (): TelemetryProvider & {
  events: TelemetryEvent[];
} => {
  const events: TelemetryEvent[] = [];
  return { events, send: (event) => events.push(event) };
};
