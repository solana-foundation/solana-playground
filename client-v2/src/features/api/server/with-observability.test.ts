// @vitest-environment node
const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  httpIntegration: vi.fn(),
  continueTrace: vi.fn((_trace: unknown, run: () => unknown) => run()),
  startSpan: vi.fn((_options: unknown, run: (span: unknown) => unknown) =>
    run({ setAttribute: vi.fn(), setStatus: vi.fn() })
  ),
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
}));
vi.mock("@sentry/node", () => sentry);

/** A fresh module, so its per-instance SDK is decided again under this test's env */
const load = async () => {
  vi.resetModules();
  return import("./with-observability.mjs");
};

const req = { method: "POST", headers: {} };
const res = { statusCode: 200 };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("tracesSampleRate", () => {
  const cases: Array<[label: string, value: string | undefined, rate: number]> =
    [
      ["traces everything when unset", undefined, 1],
      ["takes a rate inside 0..1", "0.25", 0.25],
      ["takes 0, which turns tracing off", "0", 0],
      ["refuses a rate above 1", "1.5", 1],
      ["refuses a negative rate", "-0.1", 1],
    ];

  // A refused rate warns; keep the test output clean
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  for (const [label, value, rate] of cases) {
    it(label, async () => {
      const { tracesSampleRate } = await load();
      expect(tracesSampleRate(value)).toBe(rate);
    });
  }
});

describe("withObservability", () => {
  it("hands the request straight to the handler where Sentry is off", async () => {
    vi.stubEnv("REACT_APP_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
    vi.stubEnv("VERCEL_ENV", "preview");
    const { withObservability } = await load();
    const handler = vi.fn(async () => "done");

    await expect(withObservability("agent", handler)(req, res)).resolves.toBe(
      "done"
    );
    expect(handler).toHaveBeenCalledWith(req, res);
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("traces each request at the configured rate where Sentry is on", async () => {
    vi.stubEnv("REACT_APP_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SENTRY_TRACES_SAMPLE_RATE", "0.25");
    const { withObservability } = await load();

    await withObservability("agent", async () => "done")(req, res);

    const { tracesSampler } = sentry.init.mock.calls[0][0];
    const inheritOrSampleWith = vi.fn((rate: number) => rate);
    expect(tracesSampler({ inheritOrSampleWith })).toBe(0.25);
    expect(sentry.startSpan.mock.calls[0][0]).toMatchObject({
      name: "POST /api/agent",
      op: "http.server",
    });
    expect(sentry.flush).toHaveBeenCalled();
  });

  it("reports a thrown error and still flushes", async () => {
    vi.stubEnv("REACT_APP_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
    vi.stubEnv("VERCEL_ENV", "production");
    const { withObservability } = await load();
    const error = new Error("boom");

    await expect(
      withObservability("agent", async () => {
        throw error;
      })(req, res)
    ).rejects.toBe(error);
    expect(sentry.captureException).toHaveBeenCalledWith(error);
    expect(sentry.flush).toHaveBeenCalled();
  });
});
