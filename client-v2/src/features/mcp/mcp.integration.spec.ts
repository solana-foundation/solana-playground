// @vitest-environment node
// `@types/mocha` also declares a global `it`, without `each`
import { it } from "vitest";
import handler from "../../../api/mcp.mjs";
import { jsonBody, postJson } from "../../test/api-handler";

/** What the auth slice reports for the caller; a case sets it itself */
const session = vi.hoisted(() => ({
  state: "signed-out" as "signed-in" | "signed-out" | "unavailable",
}));

vi.mock("@/features/auth/server.mjs", async (importOriginal) => {
  const real = await importOriginal<
    typeof import("@/features/auth/server.mjs")
  >();
  return {
    isAllowedOrigin: real.isAllowedOrigin,
    readSession: async () =>
      session.state === "signed-in"
        ? { status: "signed-in", user: { id: "user-1" } }
        : { status: session.state },
  };
});

/**
 * Explorer is listed for every caller. The bot-protection bypass is ours, so
 * it rides only on a signed-in caller's requests from this site; anyone else
 * reaches Explorer without it.
 */
describe("/api/mcp with the Explorer bypass configured", () => {
  beforeEach(() => {
    vi.stubEnv("MCP_EXPLORER_BYPASS", "bypass-secret");
    vi.stubEnv("AUTH_BASE_URL", "https://app.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const CALLERS = [
    ["a signed-in caller on this site", "signed-in", undefined],
    ["a signed-out caller", "signed-out", undefined],
    ["a caller whose session lookup failed", "unavailable", undefined],
    [
      "a signed-in caller on another site",
      "signed-in",
      "https://elsewhere.test",
    ],
  ] as const;

  it.each(CALLERS)("lists Explorer to %s", async (_label, state, origin) => {
    session.state = state;

    const res = await postJson(handler, "", {
      method: "GET",
      headers: origin ? { origin } : {},
    });

    expect(
      jsonBody<{ servers: Array<{ id: string }> }>(res).servers.map((s) => s.id)
    ).toEqual(["solana", "explorer"]);
  });

  /** The bypass header on every request the gateway made to Explorer, one entry per request */
  const bypassSent = async (origin?: string) => {
    const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}', {
          headers: { "content-type": "application/json" },
        })
    );

    await postJson(handler, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}', {
      url: "/api/mcp?server=explorer",
      headers: origin ? { origin } : {},
    });

    expect(upstream).toHaveBeenCalled();
    return upstream.mock.calls.map(
      ([, init]) =>
        (init?.headers as Record<string, string>)["x-vercel-protection-bypass"]
    );
  };

  it("sends the bypass for a signed-in caller on this site", async () => {
    session.state = "signed-in";
    expect(new Set(await bypassSent())).toEqual(new Set(["bypass-secret"]));
  });

  it.each(CALLERS.slice(1))(
    "sends no bypass for %s",
    async (_label, state, origin) => {
      session.state = state;
      expect(new Set(await bypassSent(origin))).toEqual(new Set([undefined]));
    }
  );
});

/**
 * `/api/mcp` refuses a body that is not a JSON object with a 400 and an
 * error that says what it wanted, whether the body arrives as a raw
 * stream or pre-parsed by the platform. `api/agent.mjs` reads its body
 * through the same `readJson`, and its spec pins the same contract.
 */
describe("POST /api/mcp body validation", () => {
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

  // A pre-parsed string stays ambiguous -- the platform hands raw text
  // over the same way -- so it is parsed rather than refused
  for (const [label, raw] of notObjects.filter(([l]) => l !== "a string")) {
    it(`refuses a pre-parsed body that is ${label}`, async () => {
      const res = await postJson(handler, raw, { preparsed: true });
      expect(res.statusCode).toBe(400);
      expect(jsonBody(res).error).toMatch(/JSON object/);
    });
  }

  it("refuses malformed JSON", async () => {
    const res = await postJson(handler, "{not json");
    expect(res.statusCode).toBe(400);
  });

  it("takes a well-formed notification, which expects no body back", async () => {
    const res = await postJson(
      handler,
      '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    );
    expect(res.statusCode).toBe(202);
  });
});
