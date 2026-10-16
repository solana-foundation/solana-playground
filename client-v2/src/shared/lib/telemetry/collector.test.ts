import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "../logger";
import { BUFFER_LIMIT, emit, initTelemetry, resetTelemetry } from "./collector";
import { memoryProvider } from "./providers/memory";

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
