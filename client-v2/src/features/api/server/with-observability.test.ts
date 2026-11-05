// @vitest-environment node
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

/** A fresh module, so its per-instance SDK is decided again under this test's env */
const load = async () => {
  vi.resetModules();
  return import("./with-observability.mjs");
};

const req = { method: "POST", headers: {} };
const res = { statusCode: 200 };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("tracesSampleRate", () => {
  const cases: Array<{
    label: string;
    value: string | undefined;
    rate: number;
  }> = [
    { label: "traces everything when unset", value: undefined, rate: 1 },
    { label: "takes a rate inside 0..1", value: "0.25", rate: 0.25 },
    { label: "takes 0, which turns tracing off", value: "0", rate: 0 },
    { label: "refuses a rate above 1", value: "1.5", rate: 1 },
    { label: "refuses a negative rate", value: "-0.1", rate: 1 },
  ];

  // A refused rate warns; keep the test output clean
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it.each(cases)("$label", async ({ value, rate }) => {
    const { tracesSampleRate } = await load();
    expect(tracesSampleRate(value)).toBe(rate);
  });
});

describe("scrubEvent", () => {
  it("drops the body, cookies, query string, user, breadcrumbs and every header but a safe few", async () => {
    const { scrubEvent } = await load();
    const event = scrubEvent(
      {
        user: { id: "u1", ip_address: "1.2.3.4" },
        breadcrumbs: [{ message: "api/agent: body" }],
        request: {
          url: "https://x.test/api/auth/callback?code=secret#frag",
          query_string: "code=secret",
          cookies: { session: "s" },
          data: { apiKey: "sk-secret" },
          headers: {
            Authorization: "Bearer sk-secret",
            Cookie: "session=s",
            "x-api-key": "sk-secret",
            "User-Agent": "jest",
            "content-type": "application/json",
          },
        },
      } as never,
      {}
    ) as never as {
      user?: unknown;
      request: Record<string, unknown>;
    };

    expect(event.user).toBeUndefined();
    expect(event).not.toHaveProperty("breadcrumbs");
    expect(event.request).toEqual({
      url: "https://x.test/api/auth/callback",
      headers: { "User-Agent": "jest", "content-type": "application/json" },
    });
  });

  it("passes an event with no request through", async () => {
    const { scrubEvent } = await load();
    expect(scrubEvent({ message: "m" } as never, {})).toEqual({ message: "m" });
  });

  /** An event as the SDK builds it for `error`, its cause first */
  const exceptionEvent = (...errors: Error[]) =>
    ({
      exception: {
        values: errors.map((error) => ({
          type: "Error",
          value: error.message,
        })),
      },
    } as never);

  const valuesOf = (event: unknown) =>
    (
      event as { exception: { values: Array<{ value: string }> } }
    ).exception.values.map(({ value }) => value);

  /** A `pg` server error as the driver raises it: a SQLSTATE and a severity */
  const pgErrorWith = (message: string, code: string) =>
    Object.assign(new Error(message), { code, severity: "ERROR" });

  it("sends a pg error by its code and constraint, never its message", async () => {
    const { scrubEvent } = await load();
    const pgError = Object.assign(
      pgErrorWith("Key (id)=(abc) already exists", "23505"),
      { constraint: "projects_pkey" }
    );

    const event = scrubEvent(exceptionEvent(pgError), {
      originalException: pgError,
    });

    expect(valuesOf(event)).toEqual(["database error 23505 (projects_pkey)"]);
  });

  it("reduces a pg error that is the cause of the one reported", async () => {
    const { scrubEvent } = await load();
    const pgError = pgErrorWith(
      'invalid input syntax for type uuid: "abc"',
      "22P02"
    );
    const wrapper = new Error("save failed", { cause: pgError });

    const event = scrubEvent(exceptionEvent(pgError, wrapper), {
      originalException: wrapper,
    });

    expect(valuesOf(event)).toEqual(["database error 22P02", "save failed"]);
  });

  it("ends on a cause chain that loops", async () => {
    const { scrubEvent } = await load();
    const pgError = pgErrorWith('invalid input: "abc"', "22P02");
    pgError.cause = pgError;

    const event = scrubEvent(exceptionEvent(pgError), {
      originalException: pgError,
    });

    expect(valuesOf(event)).toEqual(["database error 22P02"]);
  });

  it.each([
    {
      label: "a connection reset",
      message: "socket hang up",
      code: "ECONNRESET",
    },
    { label: "a broken pipe", message: "write EPIPE", code: "EPIPE" },
  ])("sends $label as it is", async ({ message, code }) => {
    const { scrubEvent } = await load();
    const error = Object.assign(new Error(message), { code });

    const event = scrubEvent(exceptionEvent(error), {
      originalException: error,
    });

    expect(valuesOf(event)).toEqual([message]);
  });

  it("drops the pg fields that quote values from extra, and keeps the rest", async () => {
    const { scrubEvent } = await load();

    const event = scrubEvent(
      {
        extra: {
          code: "23505",
          constraint: "projects_pkey",
          detail: "Key (id)=(abc) already exists.",
          hint: "abc",
        },
      } as never,
      {}
    ) as never as { extra: Record<string, unknown> };

    expect(event.extra).toEqual({ code: "23505", constraint: "projects_pkey" });
  });

  it("sends the event stripped, and prints why, when scrubbing it throws", async () => {
    const print = vi.spyOn(console, "error").mockImplementation(() => {});
    const { scrubEvent } = await load();
    const error = new Error('invalid input: "abc"');
    Object.defineProperty(error, "cause", {
      get: () => {
        throw new Error("cause getter");
      },
    });

    const event = scrubEvent(
      {
        exception: { values: [{ type: "Error", value: error.message }] },
        request: { data: { apiKey: "sk-secret" } },
        extra: { body: "abc" },
      } as never,
      { originalException: error }
    ) as never as Record<string, unknown>;

    expect(valuesOf(event)).toEqual(["(not sent: scrubbing the event failed)"]);
    expect(event).not.toHaveProperty("request");
    expect(event).not.toHaveProperty("extra");
    expect(print.mock.calls[0][0]).toBe("[api:observability]");
  });
});

describe("scrubSpan", () => {
  it("drops the query from an outgoing request's URL", async () => {
    const { scrubSpan } = await load();
    const span = scrubSpan({
      attributes: {
        "url.query": "key=secret",
        "url.full": "https://mcp.test/x?key=secret",
        "http.url": { value: "https://mcp.test/x?key=secret", type: "string" },
        "http.request.method": "GET",
      },
    } as never) as never as { attributes: Record<string, unknown> };

    expect(span.attributes).toEqual({
      "url.full": "https://mcp.test/x",
      "http.url": "https://mcp.test/x",
      "http.request.method": "GET",
    });
  });

  it("drops a database span's status message and its connection string's query", async () => {
    const { scrubSpan } = await load();
    const span = scrubSpan({
      attributes: {
        "sentry.op": "db.query",
        "sentry.status.message": 'invalid input syntax for type uuid: "abc"',
        "db.connection_string": "postgres://db.test:5432/pg?sslmode=require",
      },
    } as never) as never as { attributes: Record<string, unknown> };

    expect(span.attributes).toEqual({
      "sentry.op": "db.query",
      "db.connection_string": "postgres://db.test:5432/pg",
    });
  });

  it("keeps the status message of a span that is not a database's", async () => {
    const { scrubSpan } = await load();
    const span = scrubSpan({
      attributes: {
        "sentry.op": "http.client",
        "sentry.status.message": "internal_error",
      },
    } as never) as never as { attributes: Record<string, unknown> };

    expect(span.attributes).toEqual({
      "sentry.op": "http.client",
      "sentry.status.message": "internal_error",
    });
  });

  it("drops every attribute, and prints why, when scrubbing a span throws", async () => {
    const print = vi.spyOn(console, "error").mockImplementation(() => {});
    const { scrubSpan } = await load();
    const attributes = Object.freeze({
      "url.full": "https://mcp.test/x?key=secret",
    });

    const span = scrubSpan({ attributes } as never) as never as {
      attributes: Record<string, unknown>;
    };

    expect(span.attributes).toEqual({});
    expect(print.mock.calls[0][0]).toBe("[api:observability]");
  });
});

describe("withObservability", () => {
  it("leaves the response alone and loads nothing without a DSN", async () => {
    vi.stubEnv("REACT_APP_SENTRY_DSN", "");
    vi.stubEnv("VERCEL_ENV", "production");
    const { withObservability } = await load();
    const handler = vi.fn(async (_req, response) => {
      response.statusCode = 500;
      return "failed";
    });
    const response = { statusCode: 200 };

    await expect(
      withObservability("agent", handler)(req, response as never)
    ).resolves.toBe("failed");
    expect(response.statusCode).toBe(500);
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.flush).not.toHaveBeenCalled();
  });

  it("installs scrubEvent and scrubSpan as the send hooks", async () => {
    vi.stubEnv("REACT_APP_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
    vi.stubEnv("VERCEL_ENV", "production");
    const { withObservability, scrubEvent, scrubSpan } = await load();

    await withObservability("agent", async () => "done")(req, res);

    const options = sentry.init.mock.calls[0][0];
    expect(options.beforeSend).toBe(scrubEvent);
    expect(options.beforeSendSpan).toBe(scrubSpan);
  });

  it("reports a 500 the handler answers through the server logger, once", async () => {
    vi.stubEnv("REACT_APP_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { withObservability } = await load();
    const { createServerLogger } = await import(
      "@/shared/lib/logger/server.mjs"
    );
    const error = new Error("driver");

    await withObservability("projects", async (_req, response) => {
      createServerLogger("api:projects").error(error, { report: true });
      response.statusCode = 500;
    })(req, { statusCode: 200 } as never);

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(
      error,
      expect.anything()
    );
  });

  it("hands the request straight to the handler where Sentry is off", async () => {
    vi.stubEnv("REACT_APP_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("SENTRY_PREVIEW_ENABLED", "");
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
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(error);
    expect(sentry.flush).toHaveBeenCalled();
  });

  it("collects no request body, cookie, header, query, user, AI text or query data", async () => {
    vi.stubEnv("REACT_APP_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
    vi.stubEnv("VERCEL_ENV", "production");
    const { withObservability } = await load();

    await withObservability("agent", async () => "done")(req, res);

    expect(sentry.init.mock.calls[0][0].dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
    });
  });

  it("sends the server logger's reported entries to Sentry once Sentry loads, and still prints them", async () => {
    vi.stubEnv("REACT_APP_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
    vi.stubEnv("VERCEL_ENV", "production");
    const print = vi.spyOn(console, "error").mockImplementation(() => {});
    const { withObservability } = await load();
    const { createServerLogger } = await import(
      "@/shared/lib/logger/server.mjs"
    );
    const error = new Error("insert failed");

    await withObservability("projects", async () =>
      createServerLogger("api:projects").error(error, { report: true })
    )(req, res);

    expect(sentry.captureException).toHaveBeenCalledWith(
      error,
      expect.anything()
    );
    expect(print).toHaveBeenCalledTimes(1);
    expect(print.mock.calls[0][0]).toBe("[api:projects]");
  });
});
