// @vitest-environment node
export {};
const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  httpIntegration: vi.fn(),
  requestDataIntegration: vi.fn(),
  continueTrace: vi.fn((_trace: unknown, run: () => unknown) => run()),
  startSpan: vi.fn((_options: unknown, run: (span: unknown) => unknown) =>
    run({ setAttribute: vi.fn(), setStatus: vi.fn() })
  ),
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
}));
vi.mock("@sentry/node", () => sentry);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("log-drain error reporting", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["configuration", "upstream"])(
    "reports and flushes the %s failure without leaking credentials",
    async (failure) => {
      vi.resetModules();
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("REACT_APP_SENTRY_DSN", "https://public@example.invalid/1");
      vi.stubEnv("VERCEL_DRAIN_SECRET", "made-up-drain-secret");
      vi.stubEnv("GRAFANA_LOKI_URL", "https://loki.example.invalid");
      vi.stubEnv("GRAFANA_LOKI_USER", "123");
      vi.stubEnv(
        "GRAFANA_LOKI_TOKEN",
        failure === "upstream" ? "made-up-token" : ""
      );
      vi.stubEnv("VERCEL_LOG_DRAIN_PROJECT_ID", "prj_test");
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("made-up-token")
      );
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { default: handler } = await import("./log-drain.mjs");
      const request = {
        method: "POST",
        headers: { "x-vercel-drain-secret": "made-up-drain-secret" },
        body: JSON.stringify({
          projectId: "prj_test",
          environment: "production",
          timestamp: 1795600000000,
          source: "lambda",
          level: "info",
          path: "/api/health",
        }),
      };
      const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
      await handler(request as never, response as never);
      expect(response.statusCode).toBe(failure === "upstream" ? 502 : 503);
      expect(sentry.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            failure === "upstream"
              ? "Loki push failed; Vercel must retry"
              : "Log drain configuration incomplete",
        }),
        expect.objectContaining({ tags: { ns: "api:log-drain" } })
      );
      expect(JSON.stringify(sentry.captureException.mock.calls)).not.toContain(
        "made-up-token"
      );
      expect(sentry.flush).toHaveBeenCalledWith(2000);
    }
  );
});
