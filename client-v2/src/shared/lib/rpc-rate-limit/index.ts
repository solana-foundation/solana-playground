/** A rate-limit answer from an RPC: who sent it and what it said */
export type RateLimit = { provider: string; reason: string };

/** Classifies a failed RPC call; `undefined` hands the error to the next provider */
export type RateLimitProvider = (error: unknown) => RateLimit | undefined;

/** The JSON-RPC code and message a failed call carries, as far as they can be read */
type RpcAnswer = { code?: number; message?: string };

const FALLBACK_REASON = "Too many requests";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The `error` of a JSON-RPC body inside a message, such as web3.js's `429 Too Many Requests: {...}` */
const bodyAnswerOf = (message: string): RpcAnswer | undefined => {
  const start = message.indexOf("{");
  const end = message.lastIndexOf("}");
  if (start === -1 || end < start) return undefined;

  let body: unknown;
  try {
    body = JSON.parse(message.slice(start, end + 1));
  } catch {
    // Braces that are not JSON are text of the message, not an RPC body
    return undefined;
  }
  if (!isRecord(body) || !isRecord(body.error)) return undefined;
  const { code, message: bodyMessage } = body.error;
  return {
    code: typeof code === "number" ? code : undefined,
    message: typeof bodyMessage === "string" ? bodyMessage : undefined,
  };
};

const rpcAnswerOf = (error: unknown): RpcAnswer => {
  if (!(error instanceof Error)) return {};
  // web3.js's `SolanaJSONRPCError` carries the JSON-RPC code as a property
  if ("code" in error && typeof error.code === "number") {
    return { code: error.code, message: error.message || undefined };
  }

  const message = error.message.trim();
  const body = bodyAnswerOf(message);
  if (body?.code !== undefined) return body;
  // An HTTP 429 web3.js gave up retrying, with no body to read a code from
  if (message.startsWith("429")) return { code: 429 };
  return {};
};

const providerFor =
  (provider: string) =>
  (code: number): RateLimitProvider =>
  (error) => {
    const answer = rpcAnswerOf(error);
    if (answer.code !== code) return undefined;
    return { provider, reason: answer.message ?? FALLBACK_REASON };
  };

/** The public Solana RPC's rate limit: JSON-RPC or HTTP code 429 */
export const solanaRpc = providerFor("Solana RPC")(429);

/** Helius's rate limit, code -32429, whether it comes with HTTP status 429 or 200 */
export const helius = providerFor("Helius")(-32429);

/**
 * The first rate limit `providers` find in `error`, asked in order.
 * A 429 without CORS headers reaches the browser as a fetch `TypeError`, which no provider can classify.
 */
export const rateLimitWith =
  (providers: RateLimitProvider[]) =>
  (error: unknown): RateLimit | undefined => {
    for (const provider of providers) {
      const rateLimit = provider(error);
      if (rateLimit) return rateLimit;
    }
    return undefined;
  };

export const rateLimitOf = rateLimitWith([solanaRpc, helius]);

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  const rpcError = (code: number, message: string) =>
    Object.assign(new Error(message), { code });

  describe("shared/lib/rpc-rate-limit", () => {
    it.each([
      {
        label: "a code property of 429",
        error: rpcError(429, "Too many requests for a specific RPC call"),
        expected: {
          provider: "Solana RPC",
          reason: "Too many requests for a specific RPC call",
        },
      },
      {
        label: "a code property of -32429",
        error: rpcError(-32429, "Too many airdrop requests"),
        expected: { provider: "Helius", reason: "Too many airdrop requests" },
      },
      {
        label: "a body with code 429",
        error: new Error(
          '429 :  {"jsonrpc":"2.0","error":{"code": 429, "message":"Too many requests for a specific RPC call"}, "id": "1" } \r\n'
        ),
        expected: {
          provider: "Solana RPC",
          reason: "Too many requests for a specific RPC call",
        },
      },
      {
        label: "a body with code -32429 after HTTP 429",
        error: new Error(
          '429 Too Many Requests: {"jsonrpc":"2.0","error":{"code":-32429,"message":"Too many airdrop requests"},"id":"1"}'
        ),
        expected: { provider: "Helius", reason: "Too many airdrop requests" },
      },
      {
        label: "a bare 429 message",
        error: new Error("429 Too Many Requests: rate limited"),
        expected: { provider: "Solana RPC", reason: FALLBACK_REASON },
      },
      {
        label: "a body without a message",
        error: new Error(
          '200 OK: {"jsonrpc":"2.0","error":{"code":-32429},"id":"1"}'
        ),
        expected: { provider: "Helius", reason: FALLBACK_REASON },
      },
      {
        label: "another JSON-RPC error",
        error: rpcError(-32002, "Transaction simulation failed"),
        expected: undefined,
      },
      {
        label: "a fetch TypeError",
        error: new TypeError("Failed to fetch"),
        expected: undefined,
      },
    ])("rateLimitOf reads $label", ({ error, expected }) => {
      expect(rateLimitOf(error)).toEqual(expected);
    });

    it("rateLimitWith returns the first provider's match", () => {
      const first: RateLimitProvider = () => ({
        provider: "first",
        reason: "a",
      });
      const second: RateLimitProvider = () => ({
        provider: "second",
        reason: "b",
      });

      expect(rateLimitWith([first, second])(new Error("x"))).toEqual({
        provider: "first",
        reason: "a",
      });
    });
  });
}
