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

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll, beforeEach, afterEach } = import.meta
    .vitest;
  describe("shared/lib/telemetry/collector", () => {
    let initLogger: typeof import("../logger").initLogger;
    let logMemory: typeof import("../logger").memoryProvider;
    let resetLogger: typeof import("../logger").resetLogger;
    let memoryProvider: typeof import("./providers/memory").memoryProvider;
    beforeAll(async () => {
      ({
        initLogger,
        memoryProvider: logMemory,
        resetLogger,
      } = await import("../logger"));
      ({ memoryProvider } = await import("./providers/memory"));
    });
    const event = (name: string) => ({ name, params: {} });

    let logged: ReturnType<typeof logMemory>;

    beforeEach(() => {
      logged = logMemory();
      initLogger({ providers: [logged] });
    });

    afterEach(() => {
      resetTelemetry();
      resetLogger();
    });

    it("should deliver an event tracked before initTelemetry once, after it", () => {
      emit(event("auth_signed_out"));
      const sent = memoryProvider();

      initTelemetry({ providers: [sent] });
      initTelemetry({ providers: [sent] });

      expect(sent.events).toEqual([event("auth_signed_out")]);
    });

    it("should keep at most BUFFER_LIMIT events and warn once about the rest", () => {
      for (let i = 0; i <= BUFFER_LIMIT + 1; i++) emit(event(`auth_${i}`));
      const sent = memoryProvider();

      initTelemetry({ providers: [sent] });

      expect(sent.events).toHaveLength(BUFFER_LIMIT);
      expect(sent.events[0].name).toBe("auth_0");
      expect(logged.entries).toEqual([
        expect.objectContaining({
          ns: "telemetry:collector",
          level: "warn",
          context: { kept: BUFFER_LIMIT, firstDropped: `auth_${BUFFER_LIMIT}` },
        }),
      ]);
    });

    it("should keep delivering to other providers and report the one that throws", () => {
      const sent = memoryProvider();
      const failure = new Error("blocked");
      const broken = {
        send: () => {
          throw failure;
        },
      };
      initTelemetry({ providers: [broken, sent] });

      emit(event("auth_signed_out"));

      expect(sent.events).toHaveLength(1);
      expect(logged.entries).toEqual([
        expect.objectContaining({
          ns: "telemetry:collector",
          level: "error",
          error: failure,
          report: true,
          context: { event: "auth_signed_out" },
        }),
      ]);
    });
  });
}
