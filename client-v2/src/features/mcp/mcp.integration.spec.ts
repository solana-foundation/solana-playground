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
 * The Explorer upstream forwards our protection bypass, so only a signed-in
 * caller on our own origin is offered it. The public Solana upstream stays
 * open to everyone.
 */
describe("/api/mcp with the Explorer bypass configured", () => {
  beforeEach(() => {
    vi.stubEnv("MCP_EXPLORER_BYPASS", "bypass-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const serverIds = async (headers: Record<string, string> = {}) => {
    const res = await postJson(handler, "", { method: "GET", headers });
    return jsonBody<{ servers: Array<{ id: string }> }>(res).servers.map(
      (s) => s.id
    );
  };

  it("hides Explorer from a signed-in caller on another site", async () => {
    session.state = "signed-in";
    vi.stubEnv("AUTH_BASE_URL", "https://app.test");
    expect(await serverIds({ origin: "https://elsewhere.test" })).toEqual([
      "solana",
    ]);
  });

  it.each(["signed-out", "unavailable"] as const)(
    "hides Explorer when the session is %s",
    async (state) => {
      session.state = state;
      expect(await serverIds()).toEqual(["solana"]);
    }
  );

  it("offers Explorer to a signed-in caller", async () => {
    session.state = "signed-in";
    expect(await serverIds()).toEqual(["solana", "explorer"]);
  });

  // Telling a signed-in caller to sign in sends them round a loop that cannot end
  it.each([
    [
      "a signed-in caller on another site",
      "signed-in",
      "https://elsewhere.test",
      /only to requests from this site/,
    ],
    [
      "a caller whose session lookup failed",
      "unavailable",
      undefined,
      /Sign-in is unavailable right now/,
    ],
    [
      "a signed-out caller",
      "signed-out",
      undefined,
      /Sign in with GitHub to use explorer/,
    ],
  ] as const)(
    "tells %s why Explorer is withheld",
    async (_label, state, origin, hint) => {
      session.state = state;
      vi.stubEnv("AUTH_BASE_URL", "https://app.test");

      const res = await postJson(
        handler,
        '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
        {
          url: "/api/mcp?server=explorer",
          headers: origin ? { origin } : {},
        }
      );

      expect(res.statusCode).toBe(400);
      expect(jsonBody(res).error).toMatch(hint);
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
