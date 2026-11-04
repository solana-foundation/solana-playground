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

afterEach(() => {
  vi.unstubAllEnvs();
  sent.envelopes.length = 0;
});

// The first case loads the real `@sentry/node`, which takes seconds on a busy machine
describe("withObservability against the real SDK", { timeout: 30_000 }, () => {
  it("sends a thrown error once, scrubbed, and rethrows it for the 500", async () => {
    vi.stubEnv("REACT_APP_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { withObservability } = await import("./with-observability.mjs");
    const { createServerLogger } = await import(
      "@/shared/lib/logger/server.mjs"
    );
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
        // Printed, not reported: it reaches the console, and so a breadcrumb
        createServerLogger("api:agent").warn(`upstream said ${key}`);
        throw boom;
      })({ method: "POST", headers: {} } as never, { statusCode: 200 } as never)
    ).rejects.toBe(boom);

    const events = errorEvents();
    expect(events).toHaveLength(1);
    expect(events[0].exception.values[0].value).toBe("boom");
    expect(JSON.stringify(sent.envelopes)).not.toContain(key);
  });

  it("sends a pg error the server logger reports once, as its code, with no value from it", async () => {
    vi.stubEnv("REACT_APP_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { withObservability } = await import("./with-observability.mjs");
    const { createServerLogger } = await import(
      "@/shared/lib/logger/server.mjs"
    );
    const value = ["user", "secret", "42"].join("-");
    const pgError = Object.assign(
      new Error(`duplicate key value violates unique constraint (${value})`),
      {
        code: "23505",
        constraint: "projects_pkey",
        detail: `Key (id)=(${value}) already exists.`,
      }
    );

    await withObservability("projects", async (_req, response) => {
      createServerLogger("api:projects").error(pgError, {
        report: true,
        context: { code: pgError.code, constraint: pgError.constraint },
      });
      response.statusCode = 500;
    })({ method: "PUT", headers: {} } as never, { statusCode: 200 } as never);

    const events = errorEvents();
    expect(events).toHaveLength(1);
    expect(events[0].exception.values[0].value).toBe(
      "database error 23505 (projects_pkey)"
    );
    expect(events[0].tags).toMatchObject({ ns: "api:projects" });
    expect(JSON.stringify(sent.envelopes)).not.toContain(value);
  });
});
