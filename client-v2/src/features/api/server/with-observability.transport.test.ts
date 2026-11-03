// @vitest-environment node
// The real SDK with a stubbed transport: what a forced 500 actually sends.
const sent = vi.hoisted(() => ({ envelopes: [] as unknown[] }));

vi.mock("@sentry/node", async (importActual) => {
  const actual = await importActual<typeof import("@sentry/node")>();
  const init = (options: Parameters<typeof actual.init>[0]) =>
    actual.init(
      // Replaces the network: every envelope the SDK would send lands here
      Object.assign({}, options, {
        transport: () => ({
          send: async (envelope: unknown) => {
            sent.envelopes.push(envelope);
            return {};
          },
          flush: async () => true,
        }),
      })
    );
  return Object.assign({}, actual, { init });
});

/** Every error event the SDK handed to the transport */
const errorEvents = () =>
  (sent.envelopes as Array<[unknown, Array<[{ type: string }, unknown]>]>)
    .flatMap(([, items]) => items)
    .filter(([header]) => header.type === "event")
    .map(([, payload]) => payload as Record<string, any>);

describe("withObservability against the real SDK", () => {
  it("sends a thrown error once, scrubbed, and rethrows it for the 500", async () => {
    vi.stubEnv("REACT_APP_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
    vi.stubEnv("VERCEL_ENV", "production");
    const { withObservability } = await import("./with-observability.mjs");
    const boom = new Error("boom");
    // Built at run time, so the test's own source lines (which the SDK sends
    // as context) never contain what the assertion looks for
    const key = ["sk", "live", "123"].join("-");
    const request = {
      url: `https://x.test/api/agent?code=${key}`,
      query_string: `code=${key}`,
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        cookie: `session=${key}`,
        "user-agent": "vitest",
      },
      cookies: { session: key },
      data: { apiKey: key },
    };

    await expect(
      withObservability("agent", async () => {
        const { getIsolationScope } = await import("@sentry/node");
        getIsolationScope().setSDKProcessingMetadata({
          normalizedRequest: request,
        });
        throw boom;
      })({ method: "POST", headers: {} } as never, { statusCode: 200 } as never)
    ).rejects.toBe(boom);

    const events = errorEvents();
    expect(events).toHaveLength(1);
    expect(events[0].exception.values[0].value).toBe("boom");
    expect(events[0].request.headers).toEqual({ "user-agent": "vitest" });
    expect(events[0].request.url).toBe("https://x.test/api/agent");
    expect(JSON.stringify(events[0])).not.toContain(key);
    vi.unstubAllEnvs();
  });
});
