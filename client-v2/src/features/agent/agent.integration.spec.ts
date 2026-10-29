// @vitest-environment node
// `@types/mocha` also declares a global `it` and `describe`, without `each`
import { describe, it } from "vitest";
import type { Mock } from "vitest";
import handler from "../../../api/agent.mjs";
import { jsonBody, makeReq, makeRes, postJson } from "../../test/api-handler";
import { toMicro, worstCaseCost } from "./server.mjs";

/**
 * What the auth slice reports for the caller. A case runs signed in unless it
 * sets `session.state` itself. `isAllowedOrigin` stays real: it reads
 * `AUTH_BASE_URL`, which a case stubs.
 */
const session = vi.hoisted(() => ({
  state: "signed-in" as
    | "signed-in"
    | "signed-out"
    | "unavailable"
    | "unconfigured",
  userId: "user-1",
}));

/**
 * The tables the route reaches through `query`, faked by the statement each
 * call runs. The SQL itself is tested against Postgres in
 * `server/ledger.test.mjs` and `server/account-age.test.mjs`; this fake has
 * the same semantics, so these cases cover the route's use of them and count
 * its round trips.
 */
const db = vi.hoisted(() => {
  type User = { githubCreatedAt: Date | null; token: string | null };
  const state = {
    users: new Map<string, User>(),
    /** `${userId}|${day}` to the day's row, in micro-USD */
    spend: new Map<string, { reserved: number; spent: number }>(),
    /** Every query and upstream call, in order */
    log: [] as string[],
    down: false,
  };

  const query = async (text: string, params: unknown[] = []) => {
    state.log.push("query");
    if (state.down) throw new Error("connect ECONNREFUSED");

    if (text.includes("insert into agent_spend")) {
      const [userId, day, ageDays, amount, newcomerCap, establishedCap] =
        params as [string, string, number, number, number, number];
      const user = state.users.get(userId);
      if (!user) return { rows: [] };
      const dated = user.githubCreatedAt !== null;
      const tier =
        dated &&
        user.githubCreatedAt!.getTime() < Date.now() - ageDays * 86400_000
          ? "established"
          : "newcomer";
      const cap = tier === "established" ? establishedCap : newcomerCap;
      const key = `${userId}|${day}`;
      const row = state.spend.get(key);
      let admitted = false;
      if (!row && amount <= cap) {
        state.spend.set(key, { reserved: amount, spent: 0 });
        admitted = true;
      } else if (row && row.spent + row.reserved + amount <= cap) {
        row.reserved += amount;
        admitted = true;
      }
      return { rows: [{ tier, dated, admitted }] };
    }
    if (text.includes("update agent_spend")) {
      const [userId, day, reserved, charge] = params as [
        string,
        string,
        number,
        number
      ];
      const row = state.spend.get(`${userId}|${day}`);
      if (row) {
        row.reserved -= reserved;
        row.spent += charge;
      }
      return { rows: [] };
    }
    if (text.includes('"accessToken"')) {
      const token = state.users.get(params[0] as string)?.token;
      return { rows: token ? [{ accessToken: token }] : [] };
    }
    if (text.includes('update "user"')) {
      const user = state.users.get(params[0] as string);
      if (user && !user.githubCreatedAt)
        user.githubCreatedAt = params[1] as Date;
      return { rows: [] };
    }
    throw new Error(`unexpected statement: ${text}`);
  };

  return { state, query };
});

vi.mock("@/features/persistence/server.mjs", async (importOriginal) => {
  const real = await importOriginal<
    typeof import("@/features/persistence/server.mjs")
  >();
  return {
    getPool: real.getPool,
    isConfigured: real.isConfigured,
    query: db.query,
  };
});

vi.mock("@/features/auth/server.mjs", async (importOriginal) => {
  const real = await importOriginal<
    typeof import("@/features/auth/server.mjs")
  >();
  return {
    SIGNED_OUT_REASON: real.SIGNED_OUT_REASON,
    isAllowedOrigin: real.isAllowedOrigin,
    // Building auth can throw (the pool), so the route must never call it outside `readSession`
    getAuth: () => {
      throw new Error("getAuth called outside readSession");
    },
    missingConfig: () =>
      session.state === "unconfigured" ? ["AUTH_SECRET"] : [],
    readSession: async () =>
      session.state === "signed-in"
        ? { status: "signed-in", user: { id: session.userId } }
        : { status: session.state },
  };
});

/** A GitHub account well past the newcomer age */
const OLD_ACCOUNT = new Date("2011-01-25T18:44:36Z");

beforeEach(() => {
  session.state = "signed-in";
  session.userId = "user-1";
  db.state.users.clear();
  db.state.spend.clear();
  db.state.log.length = 0;
  db.state.down = false;
  // Dated, so a case not about the account age never looks it up
  db.state.users.set("user-1", {
    githubCreatedAt: OLD_ACCOUNT,
    token: "gho_1",
  });
  db.state.users.set("user-2", {
    githubCreatedAt: OLD_ACCOUNT,
    token: "gho_2",
  });
});

/**
 * Only a signed-in caller from our own site spends the deployment's key. Every
 * refusal has to land before the upstream is dialled, or the key is spent on
 * the way to refusing.
 */
describe("POST /api/agent sign-in gate", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_API_KEY", "k");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const TURN = '{"messages":[{"role":"user","content":"hi"}]}';

  it("refuses a signed-out caller with 401 and never reaches the upstream", async () => {
    const upstream = vi.spyOn(globalThis, "fetch");
    session.state = "signed-out";

    const res = await postJson(handler, TURN);

    expect(res.statusCode).toBe(401);
    expect(jsonBody<{ reason?: string }>(res).reason).toBe("signed-out");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller before reading the body", async () => {
    session.state = "signed-out";

    const res = await postJson(handler, "{not json");

    expect(res.statusCode).toBe(401);
  });

  it("answers 503 when sign-in is not configured, and never reaches the upstream", async () => {
    const upstream = vi.spyOn(globalThis, "fetch");
    session.state = "unconfigured";

    const res = await postJson(handler, TURN);

    expect(res.statusCode).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("answers 503, not 401, when the session lookup fails", async () => {
    const upstream = vi.spyOn(globalThis, "fetch");
    session.state = "unavailable";

    const res = await postJson(handler, TURN);

    expect(res.statusCode).toBe(503);
    expect(jsonBody<{ reason?: string }>(res).reason).toBeUndefined();
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses a turn from another site with 403 and never reaches the upstream", async () => {
    const upstream = vi.spyOn(globalThis, "fetch");
    vi.stubEnv("AUTH_BASE_URL", "https://app.test");

    const res = await postJson(handler, TURN, {
      headers: { origin: "https://elsewhere.test" },
    });

    expect(res.statusCode).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
});

/** Discovery tells the panel whether a turn could be answered at all */
describe("GET /api/agent", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_API_KEY", "k");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["unconfigured", false],
    ["signed-out", true],
  ] as const)(
    "reports configured: %s sign-in -> %s",
    async (state, configured) => {
      session.state = state;

      const res = await postJson(handler, "", { method: "GET" });

      expect(res.statusCode).toBe(200);
      expect(jsonBody<{ configured: boolean }>(res).configured).toBe(
        configured
      );
    }
  );
});

/**
 * The default-backend rail, pinned against the real handler.
 *
 * A body that is not a JSON object is refused with a 400 on both
 * delivery paths -- a raw stream and a body the platform pre-parsed.
 * The guard is `readJson` (`src/features/api/server/read-json.mjs`),
 * shared with `/api/mcp`; this spec proves the rail goes through it.
 */
describe("POST /api/agent body validation", () => {
  beforeEach(() => {
    // A configured rail, so requests get past the 503 and into parsing
    vi.stubEnv("AGENT_BASE_URL", "https://llm.test/v1");
    vi.stubEnv("AGENT_MODEL", "test-model");
    vi.stubEnv("AGENT_API_KEY", "k");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const notObjects: Array<[label: string, raw: string]> = [
    ["null", "null"],
    ["a number", "42"],
    ["a string", '"hello"'],
    ["an array", "[]"],
  ];

  for (const [label, raw] of notObjects) {
    it(`refuses a streamed body that is ${label}`, async () => {
      const res = await postJson(handler, raw);
      expect(res.statusCode).toBe(400);
      expect(jsonBody(res).error).toMatch(/JSON object/);
    });
  }

  // A pre-parsed string is the one shape that stays ambiguous: the
  // platform hands raw text over that way too, so it is parsed rather
  // than refused, and lands on the malformed-JSON 400 below.
  for (const [label, raw] of notObjects.filter(([l]) => l !== "a string")) {
    it(`refuses a pre-parsed body that is ${label}`, async () => {
      // `preparsed` also drains the stream, the way Vercel does, so a
      // handler that fell through to it would answer about `messages`
      const res = await postJson(handler, raw, { preparsed: true });
      expect(res.statusCode).toBe(400);
      expect(jsonBody(res).error).toMatch(/JSON object/);
    });
  }

  it("answers 400 to a pre-parsed body that is not JSON at all", async () => {
    const res = await postJson(handler, '"hello"', { preparsed: true });
    expect(res.statusCode).toBe(400);
    expect(jsonBody(res).error).toMatch(/Malformed/);
  });

  it("still names the missing messages on an empty object", async () => {
    const res = await postJson(handler, "{}");
    expect(res.statusCode).toBe(400);
    expect(jsonBody(res).error).toMatch(/messages/);
  });

  it("still answers 400 to malformed JSON", async () => {
    const res = await postJson(handler, "{not json");
    expect(res.statusCode).toBe(400);
    expect(jsonBody(res).error).toMatch(/Malformed/);
  });

  const missingKeys: Array<[label: string, key: string | undefined]> = [
    ["unset", undefined],
    ["empty", ""],
  ];

  for (const [label, key] of missingKeys) {
    it(`answers 503 when the key is ${label}, before reading the body`, async () => {
      vi.stubEnv("AGENT_API_KEY", key);
      const res = await postJson(handler, "null");
      expect(res.statusCode).toBe(503);
    });
  }
});

/**
 * What reaches the upstream. The key alone has to be enough: everything else
 * has a default in `upstream`, and each variable overrides its own part.
 */
describe("POST /api/agent upstream request", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_BASE_URL", undefined);
    vi.stubEnv("AGENT_MODEL", undefined);
    vi.stubEnv("AGENT_REASONING_EFFORT", undefined);
    vi.stubEnv("AGENT_API_KEY", "k");
    (globalThis as { fetch: unknown }).fetch = vi.fn(async () => ({
      ok: false,
      status: 418,
      text: async () => "",
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  /** The url and parsed body of the one upstream call a turn makes */
  const sent = async () => {
    await postJson(handler, '{"messages":[{"role":"user","content":"hi"}]}');
    const [url, init] = (globalThis.fetch as Mock).mock.calls[0];
    return { url, body: JSON.parse(init.body) };
  };

  it("defaults to GLM 5.3 Flash on Nous with low effort", async () => {
    const { url, body } = await sent();
    expect(url).toBe(
      "https://inference-api.nousresearch.com/v1/chat/completions"
    );
    expect(body.model).toBe("z-ai/glm-5.3-flash:US");
    expect(body.reasoning_effort).toBe("low");
    // Nous answers `400 unknown_parameter` to it
    expect(body).not.toHaveProperty("providerOptions");
    // and `400 unsupported_parameter` to `max_tokens` for this model
    expect(body.max_completion_tokens).toBe(8192);
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("restricts the Gateway to its default providers", async () => {
    vi.stubEnv("AGENT_BASE_URL", "https://ai-gateway.vercel.sh/v1");
    const { body } = await sent();
    expect(body.providerOptions).toEqual({
      gateway: { only: ["baseten", "fireworks"] },
    });
  });

  it("lets each variable override its own default", async () => {
    vi.stubEnv("AGENT_BASE_URL", "https://llm.test/v1");
    vi.stubEnv("AGENT_MODEL", "test-model");
    vi.stubEnv("AGENT_REASONING_EFFORT", "high");
    const { url, body } = await sent();
    expect(url).toBe("https://llm.test/v1/chat/completions");
    expect(body.model).toBe("test-model");
    expect(body.reasoning_effort).toBe("high");
  });
});

/**
 * The streaming half. The upstream is faked, so what these cover is the
 * proxy's own behaviour once the 200 and the SSE headers are committed:
 * everything it has to say from then on has to go inside the stream.
 */
describe("POST /api/agent streaming", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_BASE_URL", "https://llm.test/v1");
    vi.stubEnv("AGENT_MODEL", "test-model");
    vi.stubEnv("AGENT_API_KEY", "k");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  /** An upstream whose stream yields `chunks`, then does what `then` says */
  const upstream = (chunks: string[], then: "end" | "fail" = "end") => {
    let i = 0;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (i < chunks.length) {
              return { done: false, value: Buffer.from(chunks[i++]) };
            }
            if (then === "fail") throw new Error("connection reset");
            return { done: true, value: undefined };
          },
          cancel: async () => {},
        }),
      },
    };
  };

  const call = async (
    res: ReturnType<typeof makeRes>,
    response: ReturnType<typeof upstream>
  ) => {
    (globalThis as { fetch: unknown }).fetch = vi.fn(async () => response);
    await handler(
      makeReq('{"messages":[{"role":"user","content":"hi"}]}'),
      res as never
    );
  };

  it("passes an upstream error's own status through", async () => {
    const res = makeRes();
    await call(res, {
      ok: false,
      status: 429,
      text: async () => "slow down",
    } as never);

    expect(res.statusCode).toBe(429);
    expect(jsonBody(res).error).toMatch(/^Upstream 429: slow down/);
  });

  /** A Gateway error body, as its FAQ lists the refusals */
  const gatewayError = (type: string, message: string) =>
    JSON.stringify({ error: { type, message } });

  // Relayed, either would read as our own refusal of the caller. The bodies
  // are the Gateway's, the free-tier one as it answered on 2026-10-29.
  it.each([
    {
      status: 401,
      body: "invalid key",
      cause: "key",
      error: "The default backend's key was refused upstream (401).",
    },
    {
      status: 403,
      body: gatewayError(
        "no_providers_available",
        "Free tier users do not have access to this model. Upgrade to paid credits for unrestricted access."
      ),
      cause: "free-tier",
      error:
        "The default backend's model is not in the Gateway's free tier; the team needs paid credits (403).",
    },
    {
      status: 403,
      body: gatewayError(
        "customer_verification_required",
        "Add a valid payment method to use free credits."
      ),
      cause: "payment-method",
      error:
        "The default backend's Gateway team needs a payment method on file (403).",
    },
    {
      status: 403,
      body: gatewayError(
        "forbidden",
        "This model is blocked by your team restrictions."
      ),
      cause: "allowlist",
      error:
        "The default backend's model or providers are outside the Gateway team's allowlist (403).",
    },
    {
      status: 403,
      body: "Forbidden",
      cause: "unknown",
      error: "The default backend was refused upstream (403).",
    },
  ])(
    "answers 502 naming the $cause when the upstream refuses with $status",
    async ({ status, body, cause, error }) => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = makeRes();
      await call(res, {
        ok: false,
        status,
        text: async () => body,
      } as never);

      expect(res.statusCode).toBe(502);
      expect(jsonBody(res).error).toBe(error);
      expect(logged).toHaveBeenCalledWith(
        "agent: upstream refused the default backend",
        expect.objectContaining({ status, cause })
      );
    }
  );

  it("answers 502 to a success that has nothing to stream", async () => {
    const res = makeRes();
    await call(res, { ok: true, status: 204, body: null } as never);

    // Relaying the 204 would send a body on a status that cannot have one
    expect(res.statusCode).toBe(502);
    expect(jsonBody(res).error).toMatch(/204.*no body/);
  });

  it("streams the upstream's events through byte for byte", async () => {
    const res = makeRes();
    await call(res, upstream(["data: a\n\n", "data: [DONE]\n\n"]));

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.body()).toBe("data: a\n\ndata: [DONE]\n\n");
    expect(res.ended).toBe(true);
  });

  it("starts the error on a fresh event when the upstream drops mid-frame", async () => {
    const res = makeRes();
    await call(res, upstream(['data: {"choices":[{"del'], "fail"));

    // Glued onto the unfinished frame, the error would be one malformed
    // line the panel skips, and the cut answer would pass for a whole one
    const events = res
      .body()
      .split("\n\n")
      .filter((e) => e.startsWith("data: "));
    const last = JSON.parse(events[events.length - 1].slice(6));
    expect(last.error.message).toMatch(/connection reset/);
  });

  it("says so inside the stream when the upstream drops mid-answer", async () => {
    const res = makeRes();
    await call(res, upstream(["data: a\n\n"], "fail"));

    // Ending quietly would let half an answer pass for a whole one
    expect(res.body()).toContain("data: a\n\n");
    expect(res.body()).toContain("Upstream stream failed");
    expect(res.body()).toContain("connection reset");
    expect(res.ended).toBe(true);
  });

  it("stops waiting for drain once the client is gone", async () => {
    // A full write buffer, so the loop parks on `drain` -- and a client
    // that leaves instead. Without `close` ending that wait the
    // invocation would park here until the platform's duration cap.
    let parked!: () => void;
    const firstWrite = new Promise<void>((resolve) => (parked = resolve));
    const res = makeRes({
      write: (c) => {
        res.chunks.push(Buffer.from(c as Uint8Array));
        parked();
        return false;
      },
    });
    const pending = call(res, upstream(["data: a\n\n", "data: b\n\n"]));

    // Only now is the handler past `readJson` and inside the drain wait
    await firstWrite;
    res.destroyed = true;
    res.emit("close");
    await pending;

    const init = (globalThis.fetch as Mock).mock.calls[0][1];
    expect((init.signal as AbortSignal).aborted).toBe(true);
    expect(res.body()).toBe("data: a\n\n");
    expect(res.ended).toBe(true);
  });
});

/**
 * The spend gate, one `describe` per requirement of the
 * `assistant-default-backend-spend` spec, by its scenarios.
 */
describe("POST /api/agent spend gate", () => {
  const GITHUB = "https://api.github.com/user";
  const TURN = '{"messages":[{"role":"user","content":"hi"}]}';
  const USAGE = { prompt_tokens: 1000, completion_tokens: 100 };
  /** What `USAGE` costs at the default prices, in micro-USD */
  const USAGE_COST = Math.ceil(1000 * 0.15 + 100 * 0.5);
  const CAP = { newcomer: toMicro(0.1), established: toMicro(0.5) };
  /** The reservation `TURN` takes at the default limits */
  const RESERVED = worstCaseCost({
    bytes: Buffer.byteLength(TURN),
    maxOutputTokens: 8192,
    prices: { input: 0.15, output: 0.5 },
  });

  beforeEach(() => {
    vi.stubEnv("AGENT_BASE_URL", "https://llm.test/v1");
    vi.stubEnv("AGENT_MODEL", "test-model");
    vi.stubEnv("AGENT_API_KEY", "established-key");
    vi.stubEnv("AGENT_NEWCOMER_API_KEY", "newcomer-key");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const today = () => new Date().toISOString().slice(0, 10);
  const spend = (userId = "user-1") =>
    db.state.spend.get(`${userId}|${today()}`) ?? { reserved: 0, spent: 0 };
  const spendSoFar = (userId: string, spent: number) =>
    db.state.spend.set(`${userId}|${today()}`, { reserved: 0, spent });

  /** An upstream stream: one text event, then the usage unless `usage` is null */
  const streamed = (usage: object | null = USAGE) => {
    const events = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      ...(usage ? [`data: ${JSON.stringify({ choices: [], usage })}\n\n`] : []),
      "data: [DONE]\n\n",
    ];
    return new Response(events.join(""), { status: 200 });
  };

  /** `Response.json`, which the TypeScript DOM lib here does not declare */
  const json = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json" },
    });

  type Answer = (init: RequestInit) => Response | Promise<Response>;

  /**
   * `fetch`, answering the upstream with `upstream` and GitHub with `github`,
   * and logging each upstream call next to the queries
   */
  const network = (
    upstream: Answer = () => streamed(),
    github: Answer = () => json({ created_at: OLD_ACCOUNT.toISOString() })
  ) => {
    const fetched = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === GITHUB) return github(init ?? {});
        db.state.log.push("upstream");
        return upstream(init ?? {});
      }
    );
    vi.stubGlobal("fetch", fetched);
    return fetched;
  };

  const upstreamCalls = (fetched: ReturnType<typeof network>) =>
    fetched.mock.calls.filter(([input]) => String(input) !== GITHUB);

  /** The parsed body and key of the n-th upstream request */
  const sent = (fetched: ReturnType<typeof network>, n = 0) => {
    const init = upstreamCalls(fetched)[n][1] as RequestInit;
    return {
      body: JSON.parse(init.body as string),
      key: (init.headers as Record<string, string>).authorization,
    };
  };

  describe("A user's daily spend is capped", () => {
    it("A turn past the cap is refused without an upstream call", async () => {
      spendSoFar("user-1", CAP.established);
      const fetched = network();

      const res = await postJson(handler, TURN);

      expect(res.statusCode).toBe(429);
      expect(jsonBody(res)).toMatchObject({
        reason: "daily-cap",
        tier: "established",
      });
      // Noon UTC: twelve hours to the reset
      expect(res.headers["retry-after"]).toBe("43200");
      expect(fetched).not.toHaveBeenCalled();
    });

    it("The cap resets at 00:00 UTC", async () => {
      vi.setSystemTime(new Date("2026-10-29T23:59:00Z"));
      spendSoFar("user-1", CAP.established);
      network();
      expect((await postJson(handler, TURN)).statusCode).toBe(429);

      vi.setSystemTime(new Date("2026-10-30T00:01:00Z"));

      expect((await postJson(handler, TURN)).statusCode).toBe(200);
    });

    it("Users do not share a cap", async () => {
      spendSoFar("user-1", CAP.established);
      const fetched = network();
      session.userId = "user-2";

      const res = await postJson(handler, TURN);

      expect(res.statusCode).toBe(200);
      expect(upstreamCalls(fetched)).toHaveLength(1);
    });
  });

  describe("Concurrent turns cannot pass the cap together", () => {
    it("Parallel turns at the edge of the cap", async () => {
      spendSoFar("user-1", CAP.established - RESERVED);
      const fetched = network();

      const answers = await Promise.all([
        postJson(handler, TURN),
        postJson(handler, TURN),
      ]);

      expect(answers.map((res) => res.statusCode).sort()).toEqual([200, 429]);
      expect(upstreamCalls(fetched)).toHaveLength(1);
    });
  });

  // The checks run by hand against the dev server on 2026-10-29, for each tier
  describe.each([
    {
      tier: "newcomer",
      // Three days before the fixed clock, well inside the newcomer age
      githubCreatedAt: new Date("2026-10-26T12:00:00Z"),
      cap: CAP.newcomer,
      key: "Bearer newcomer-key",
    },
    {
      tier: "established",
      githubCreatedAt: OLD_ACCOUNT,
      cap: CAP.established,
      key: "Bearer established-key",
    },
  ])("The $tier cap at its edge", ({ tier, githubCreatedAt, cap, key }) => {
    beforeEach(() => {
      db.state.users.set("user-1", { githubCreatedAt, token: "gho_1" });
    });

    it("refuses a turn whose worst case does not fit the room left", async () => {
      spendSoFar("user-1", cap - RESERVED + 1);
      const fetched = network();

      const res = await postJson(handler, TURN);

      expect(res.statusCode).toBe(429);
      expect(jsonBody(res)).toMatchObject({ reason: "daily-cap", tier });
      expect(res.headers["retry-after"]).toBe("43200");
      expect(fetched).not.toHaveBeenCalled();
      expect(spend()).toEqual({ reserved: 0, spent: cap - RESERVED + 1 });
    });

    it("admits a turn whose worst case just fits, and charges its usage", async () => {
      spendSoFar("user-1", cap - RESERVED);
      const fetched = network();

      const res = await postJson(handler, TURN);

      expect(res.statusCode).toBe(200);
      expect(sent(fetched).key).toBe(key);
      expect(spend()).toEqual({
        reserved: 0,
        spent: cap - RESERVED + USAGE_COST,
      });
    });

    it("admits one of two parallel turns with room for one", async () => {
      spendSoFar("user-1", cap - RESERVED);
      const fetched = network();

      const answers = await Promise.all([
        postJson(handler, TURN),
        postJson(handler, TURN),
      ]);

      expect(answers.map((res) => res.statusCode).sort()).toEqual([200, 429]);
      expect(upstreamCalls(fetched)).toHaveLength(1);
      expect(spend()).toEqual({
        reserved: 0,
        spent: cap - RESERVED + USAGE_COST,
      });
    });
  });

  describe("A turn is charged what it cost", () => {
    it("A completed turn is charged its reported usage", async () => {
      network();

      await postJson(handler, TURN);

      expect(spend()).toEqual({ reserved: 0, spent: USAGE_COST });
    });

    it("A turn that ends without reported usage is charged the reservation", async () => {
      network(() => streamed(null));

      await postJson(handler, TURN);

      expect(spend()).toEqual({ reserved: 0, spent: RESERVED });
    });

    it("A turn the caller abandons is charged the reservation", async () => {
      // The usage would come last; the caller leaves after the first event
      const res = makeRes({
        write: (chunk) => {
          res.chunks.push(Buffer.from(chunk as Uint8Array));
          res.destroyed = true;
          res.emit("close");
          return true;
        },
      });
      network(
        () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                controller.enqueue(
                  new TextEncoder().encode('data: {"choices":[]}\n\n')
                );
              },
            }),
            { status: 200 }
          )
      );

      await handler(makeReq(TURN), res as never);

      expect(spend()).toEqual({ reserved: 0, spent: RESERVED });
    });

    it("charges the reservation, not the usage seen so far, to a turn the caller abandons", async () => {
      // An upstream that reports a running total on every event
      const running = `data: ${JSON.stringify({
        choices: [],
        usage: USAGE,
      })}\n\n`;
      const res = makeRes({
        write: (chunk) => {
          res.chunks.push(Buffer.from(chunk as Uint8Array));
          res.destroyed = true;
          res.emit("close");
          return true;
        },
      });
      network(
        () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                controller.enqueue(new TextEncoder().encode(running));
              },
            }),
            { status: 200 }
          )
      );

      await handler(makeReq(TURN), res as never);

      expect(spend()).toEqual({ reserved: 0, spent: RESERVED });
    });

    it("charges the reservation to a turn the caller abandons before the upstream answers", async () => {
      const res = makeRes();
      // The caller hangs up while the upstream is still working on the
      // request; the route's abort is what rejects the fetch
      network(
        (init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            );
            res.destroyed = true;
            res.emit("close");
          })
      );

      await handler(makeReq(TURN), res as never);

      expect(spend()).toEqual({ reserved: 0, spent: RESERVED });
    });

    it("A turn the upstream refuses is not charged", async () => {
      network(() => new Response("overloaded", { status: 529 }));

      const res = await postJson(handler, TURN);

      expect(res.statusCode).toBe(529);
      expect(spend()).toEqual({ reserved: 0, spent: 0 });
    });

    it("A turn that cannot reach the upstream is not charged", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ENOTFOUND")));

      const res = await postJson(handler, TURN);

      expect(res.statusCode).toBe(502);
      expect(spend()).toEqual({ reserved: 0, spent: 0 });
    });
  });

  describe("One request's cost is bounded", () => {
    it("An oversized body is refused", async () => {
      vi.stubEnv("AGENT_MAX_BODY_BYTES", "16");
      const fetched = network();

      const res = await postJson(handler, TURN);

      expect(res.statusCode).toBe(413);
      expect(fetched).not.toHaveBeenCalled();
      expect(db.state.spend.size).toBe(0);
    });

    it("The caller cannot raise the output limit", async () => {
      const fetched = network();

      await postJson(
        handler,
        JSON.stringify({
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 200000,
          max_completion_tokens: 200000,
        })
      );

      const { body } = sent(fetched);
      expect(body.max_completion_tokens).toBe(8192);
      expect(body).not.toHaveProperty("max_tokens");
      expect(body.stream_options).toEqual({ include_usage: true });
    });

    it("names the output limit the same way to the Gateway", async () => {
      vi.stubEnv("AGENT_BASE_URL", "https://ai-gateway.vercel.sh/v1");
      const fetched = network();

      await postJson(handler, TURN);

      const { body } = sent(fetched);
      expect(body.max_completion_tokens).toBe(8192);
      expect(body).not.toHaveProperty("max_tokens");
    });
  });

  describe("Turns are served only by the configured providers", () => {
    it("The upstream request names the providers", async () => {
      vi.stubEnv("AGENT_PROVIDERS", "baseten,fireworks");
      const fetched = network();

      await postJson(handler, TURN);

      expect(sent(fetched).body.providerOptions).toEqual({
        gateway: { only: ["baseten", "fireworks"] },
      });
    });

    it("The caller cannot widen the list", async () => {
      vi.stubEnv("AGENT_PROVIDERS", "baseten,fireworks");
      const fetched = network();

      await postJson(
        handler,
        JSON.stringify({
          messages: [{ role: "user", content: "hi" }],
          providerOptions: { gateway: { only: ["anyone"] } },
          provider: { only: ["anyone"] },
        })
      );

      const { body } = sent(fetched);
      expect(body.providerOptions).toEqual({
        gateway: { only: ["baseten", "fireworks"] },
      });
      expect(body).not.toHaveProperty("provider");
    });

    it("No providers configured", async () => {
      vi.stubEnv("AGENT_PROVIDERS", "");
      const fetched = network();

      await postJson(handler, TURN);

      expect(sent(fetched).body).not.toHaveProperty("providerOptions");
    });
  });

  describe("New GitHub accounts spend from their own pool", () => {
    const createdDaysAgo = (days: number) =>
      new Date(Date.now() - days * 86400_000);

    it("A new account is a newcomer", async () => {
      db.state.users.set("user-1", {
        githubCreatedAt: createdDaysAgo(3),
        token: "gho_1",
      });
      spendSoFar("user-1", CAP.newcomer - RESERVED + 1);
      const fetched = network();

      const res = await postJson(handler, TURN);

      // Held to the newcomer cap: the same spend leaves an established user room
      expect(res.statusCode).toBe(429);
      expect(jsonBody(res)).toMatchObject({ tier: "newcomer" });
      db.state.spend.clear();
      await postJson(handler, TURN);
      expect(sent(fetched).key).toBe("Bearer newcomer-key");
    });

    it("An old account is established", async () => {
      spendSoFar("user-1", CAP.newcomer);
      const fetched = network();

      const res = await postJson(handler, TURN);

      expect(res.statusCode).toBe(200);
      expect(sent(fetched).key).toBe("Bearer established-key");
    });

    it("An unknown account age is treated as new", async () => {
      db.state.users.set("user-1", { githubCreatedAt: null, token: null });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetched = network();

      await postJson(handler, TURN);

      expect(sent(fetched).key).toBe("Bearer newcomer-key");
    });

    it("spends through the one key when no newcomer key is set", async () => {
      vi.stubEnv("AGENT_NEWCOMER_API_KEY", "");
      db.state.users.set("user-1", {
        githubCreatedAt: createdDaysAgo(3),
        token: "gho_1",
      });
      const fetched = network();

      await postJson(handler, TURN);

      expect(sent(fetched).key).toBe("Bearer established-key");
    });
  });

  describe("The account age is learned after a turn", () => {
    beforeEach(() => {
      db.state.users.set("user-1", { githubCreatedAt: null, token: "gho_1" });
    });

    it("The first turn learns the age", async () => {
      const fetched = network();

      await postJson(handler, TURN);
      await postJson(handler, TURN);

      expect(sent(fetched, 0).key).toBe("Bearer newcomer-key");
      expect(db.state.users.get("user-1")!.githubCreatedAt).toEqual(
        OLD_ACCOUNT
      );
      expect(sent(fetched, 1).key).toBe("Bearer established-key");
    });

    it("The lookup starts after the response ends", async () => {
      let answerGitHub!: (response: Response) => void;
      const res = makeRes();
      network(
        () => streamed(),
        () =>
          new Promise<Response>((resolve) => {
            // GitHub is asked only once the caller has the whole answer
            expect(res.ended).toBe(true);
            answerGitHub = resolve;
          })
      );

      const pending = handler(makeReq(TURN), res as never);
      await vi.waitFor(() => expect(answerGitHub).toBeDefined());

      expect(res.ended).toBe(true);
      expect(db.state.users.get("user-1")!.githubCreatedAt).toBeNull();
      answerGitHub(json({ created_at: OLD_ACCOUNT.toISOString() }));
      await pending;
      expect(db.state.users.get("user-1")!.githubCreatedAt).toEqual(
        OLD_ACCOUNT
      );
    });

    it("A failed lookup is tried again", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetched = network(
        () => streamed(),
        () => new Response("Bad credentials", { status: 401 })
      );

      await postJson(handler, TURN);
      expect(db.state.users.get("user-1")!.githubCreatedAt).toBeNull();
      await postJson(handler, TURN);

      expect(sent(fetched, 1).key).toBe("Bearer newcomer-key");
      const githubCalls = fetched.mock.calls.filter(
        ([input]) => String(input) === GITHUB
      );
      expect(githubCalls).toHaveLength(2);
    });

    it("looks the age up after a refused turn too", async () => {
      spendSoFar("user-1", CAP.newcomer);
      network();

      expect((await postJson(handler, TURN)).statusCode).toBe(429);

      expect(db.state.users.get("user-1")!.githubCreatedAt).toEqual(
        OLD_ACCOUNT
      );
    });
  });

  describe("An exhausted pool is reported as such", () => {
    it.each([
      ["The tier's pool is empty", "quota_for_entity_exceeded"],
      ["The credit balance is empty", "insufficient_funds"],
    ])("%s", async (_, type) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      network(() =>
        json({ error: { message: "spent", type } }, { status: 402 })
      );

      const res = await postJson(handler, TURN);

      expect(res.statusCode).toBe(503);
      expect(jsonBody(res)).toMatchObject({
        reason: "pool-exhausted",
        tier: "established",
      });
      expect(res.headers["retry-after"]).toBe("43200");
      expect(spend()).toEqual({ reserved: 0, spent: 0 });
    });

    it("relays a 402 that is not the Gateway's budget as the upstream's", async () => {
      network(() => new Response("Payment required", { status: 402 }));

      const res = await postJson(handler, TURN);

      expect(res.statusCode).toBe(402);
      expect(jsonBody<{ reason?: string }>(res).reason).toBeUndefined();
    });
  });

  describe("The gate fails closed", () => {
    it("The ledger is unreachable", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      db.state.down = true;
      const fetched = network();

      const res = await postJson(handler, TURN);

      expect(res.statusCode).toBe(503);
      expect(fetched).not.toHaveBeenCalled();
    });
  });

  it("issues one query before the upstream call and one after", async () => {
    network();

    await postJson(handler, TURN);

    expect(db.state.log).toEqual(["query", "upstream", "query"]);
  });
});
