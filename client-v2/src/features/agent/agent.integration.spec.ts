// @vitest-environment node
// `@types/mocha` also declares a global `it`, without `each`
import { it } from "vitest";
import type { Mock } from "vitest";
import handler from "../../../api/agent.mjs";
import { jsonBody, makeReq, makeRes, postJson } from "../../test/api-handler";

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
}));

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
        ? { status: "signed-in", user: { id: "user-1" } }
        : { status: session.state },
  };
});

beforeEach(() => {
  session.state = "signed-in";
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

  // Relayed, either would read as our own refusal of the caller
  it.each([401, 403])(
    "answers 502 when the upstream refuses the key with %i",
    async (status) => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = makeRes();
      await call(res, {
        ok: false,
        status,
        text: async () => "invalid key",
      } as never);

      expect(res.statusCode).toBe(502);
      expect(jsonBody(res).error).toBe(
        `The default backend's key was refused upstream (${status}).`
      );
      expect(logged).toHaveBeenCalled();
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
