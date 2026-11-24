// @vitest-environment node
// The real SDK with a stubbed transport: what a forced 500 actually sends.
import { createServer as createHttpServer, get } from "node:http";
import { type AddressInfo, createServer as createTcpServer } from "node:net";

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

/** Every span the SDK handed to the transport, by name */
const sentSpans = () =>
  new Map(
    (sent.envelopes as Array<[unknown, Array<[{ type: string }, unknown]>]>)
      .flatMap(([, items]) => items)
      .filter(([header]) => header.type === "span")
      .flatMap(
        ([, payload]) =>
          (payload as { items: Array<Record<string, any>> }).items
      )
      .map((span) => [span.name as string, span])
  );

const servers: Array<{ close: () => unknown }> = [];

/** Listens on a free local port until `afterEach` closes it */
const listening = async (
  server: ReturnType<typeof createTcpServer | typeof createHttpServer>
) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return (server.address() as AddressInfo).port;
};

/** One message of the Postgres wire protocol: a type byte, a length, a body */
const pgMessage = (type: string, body: Buffer) => {
  const header = Buffer.alloc(5);
  header.write(type, 0);
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
};

const PG_READY = pgMessage("Z", Buffer.from("I"));
const PG_AUTHENTICATED = pgMessage("R", Buffer.alloc(4));
/** The `Sync` that ends `pg`'s extended-protocol query */
const PG_SYNC = Buffer.from("S\0\0\0\x04", "latin1");

/**
 * A Postgres server that accepts any login and fails every query with
 * `message`, as a real server does with a value the query was given
 */
const pgServerFailingWith = (code: string, message: string) =>
  createTcpServer((socket) => {
    let started = false;
    socket.on("data", (data) => {
      if (!started) {
        started = true;
        socket.write(Buffer.concat([PG_AUTHENTICATED, PG_READY]));
        return;
      }
      if (!data.includes(PG_SYNC)) return;
      const fields = `SERROR\0VERROR\0C${code}\0M${message}\0\0`;
      socket.write(
        Buffer.concat([pgMessage("E", Buffer.from(fields)), PG_READY])
      );
    });
  });

afterEach(() => {
  vi.unstubAllEnvs();
  sent.envelopes.length = 0;
  for (const server of servers.splice(0)) server.close();
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
    // The request's span was sent too, so the check below covers spans as well
    expect(JSON.stringify(sent.envelopes)).toContain("POST /api/agent");
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
        severity: "ERROR",
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

  it("reduces a pg error that is the cause of a thrown one, as the SDK links it", async () => {
    vi.stubEnv("REACT_APP_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
    vi.stubEnv("VERCEL_ENV", "production");
    const { withObservability } = await import("./with-observability.mjs");
    const input = ["uuid", "secret", "7"].join("-");
    const pgError = Object.assign(
      new Error(`invalid input syntax for type uuid: "${input}"`),
      { code: "22P02", severity: "ERROR" }
    );
    const wrapper = new Error("save failed", { cause: pgError });

    await expect(
      withObservability("projects", async () => {
        throw wrapper;
      })({ method: "PUT", headers: {} } as never, { statusCode: 200 } as never)
    ).rejects.toBe(wrapper);

    const events = errorEvents();
    expect(events).toHaveLength(1);
    expect(
      events[0].exception.values.map(({ value }: { value: string }) => value)
    ).toEqual(["database error 22P02", "save failed"]);
    expect(JSON.stringify(sent.envelopes)).not.toContain(input);
  });

  it("sends an outgoing request's span with its URL but not its query string", async () => {
    vi.stubEnv("REACT_APP_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
    vi.stubEnv("VERCEL_ENV", "production");
    const port = await listening(
      createHttpServer((_request, response) => response.end("ok"))
    );
    const { withObservability } = await import("./with-observability.mjs");
    const token = ["mcp", "token", "9"].join("-");

    await withObservability("agent", async () => {
      // `node:http`, which the SDK instruments as it does `fetch`: the test
      // setup replaces the global `fetch` with one that throws
      await new Promise<void>((resolve, reject) =>
        // eslint-disable-next-line @microsoft/sdl/no-insecure-url -- the loopback server this test starts; the exception cannot see an interpolated port
        get(`http://127.0.0.1:${port}/mcp?token=${token}`, (response) => {
          response.resume();
          response.on("end", resolve);
        }).on("error", reject)
      );
    })({ method: "POST", headers: {} } as never, { statusCode: 200 } as never);

    const span = sentSpans().get("GET 127.0.0.1");
    expect(span?.attributes["sentry.op"].value).toBe("http.client");
    expect(span?.attributes["url.full"].value).toBe(
      // eslint-disable-next-line @microsoft/sdl/no-insecure-url -- the loopback server this test starts; the exception cannot see an interpolated port
      `http://127.0.0.1:${port}/mcp`
    );
    expect(JSON.stringify(sent.envelopes)).not.toContain(token);
  });

  it("sends a failed query's span without the driver's message", async () => {
    vi.stubEnv("REACT_APP_SENTRY_DSN", "https://key@o0.ingest.sentry.io/0");
    vi.stubEnv("VERCEL_ENV", "production");
    const input = ["uuid", "secret", "8"].join("-");
    const port = await listening(
      pgServerFailingWith(
        "22P02",
        `invalid input syntax for type uuid: "${input}"`
      )
    );
    const { withObservability } = await import("./with-observability.mjs");

    await withObservability("projects", async (_req, response) => {
      // Loaded after `Sentry.init`, which instruments `pg` as it loads
      // @ts-expect-error -- `pg` ships no types, and this package has no `@types/pg`
      const { default: pg } = await import("pg");
      const client = new pg.Client({
        host: "127.0.0.1",
        port,
        user: "u",
        database: "d",
        password: "p",
      });
      await client.connect();
      await expect(client.query("select $1::uuid", [input])).rejects.toThrow(
        input
      );
      await client.end();
      response.statusCode = 500;
    })({ method: "PUT", headers: {} } as never, { statusCode: 200 } as never);

    const span = sentSpans().get("select");
    expect(span?.attributes["sentry.op"].value).toBe("db");
    expect(span?.status).toBe("error");
    expect(JSON.stringify(sent.envelopes)).not.toContain(input);
  });
});
