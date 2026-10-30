/**
 * Which failure a provider's answer is, for the words a user reads and for
 * whether the team hears of it. Only a 401 says the key was refused: a 403 is
 * as often a region, a policy or a quota, and "check your key" alone would
 * send the user to the wrong fix.
 */
export type AiFailureKind =
  | "busy"
  | "key-refused"
  | "forbidden"
  | "no-model"
  | "too-long"
  | "invalid"
  | "provider";

/**
 * How providers word a request past the model's context in a 400: Anthropic
 * ("prompt is too long"), OpenAI (`context_length_exceeded`, "maximum context
 * length"), Gemini ("exceeds the maximum number of tokens") and the
 * OpenAI-compatible servers that copy them
 */
const TOO_LONG =
  /prompt is too long|context_length_exceeded|maximum context length|context window|exceeds the maximum number of tokens/i;

/** Gemini refuses a bad key with a 400, not a 401 */
const KEY_INVALID = /API_KEY_INVALID|API key not valid/i;

/** Anthropic's 529, and the 502, 503 and 504 of a gateway */
const OUTAGE = new Set([502, 503, 504, 529]);

/**
 * Whether a status says a provider or its host is down or overloaded. A third
 * party's outage is on its status page, so `isReportedFailure` leaves it out;
 * a backend we run reports its own (`TurnProfile.reportsOutage`).
 */
export const isOutage = (status: number | undefined) =>
  status !== undefined && OUTAGE.has(status);

/** The kind of a failed response, from its status and its (redacted) body */
export const failureKindOf = (
  status: number | undefined,
  body: string | undefined
): AiFailureKind => {
  if (status === 429) return "busy";
  if (status === 401) return "key-refused";
  if (status === 403) return "forbidden";
  if (status === 404) return "no-model";
  if (status === 413) return "too-long";
  if (status === 422) return "invalid";
  if (status === 400) {
    if (body && KEY_INVALID.test(body)) return "key-refused";
    return body && TOO_LONG.test(body) ? "too-long" : "invalid";
  }
  return "provider";
};

/**
 * Spec 08's words for a failed model request (AI-03, AI-05, and the
 * assistant's "Could not …" fallback): no status, JSON or server text.
 * `forbidden`, `no-model`, `too-long` and `invalid` have no Spec 08 state yet;
 * their words are Lead's (30 Oct), raised to the designers as a Spec 08 gap.
 */
export const FAILURE_MESSAGE: Record<AiFailureKind, string> = {
  busy: "The model is busy.",
  "key-refused":
    "The model's provider did not accept this key. Check it in Settings, or use the hosted model.",
  forbidden:
    "The provider refused this request for this key. It may not have access to this model. Check the key in Settings, or pick another model.",
  "no-model": "The provider has no model by this name. Pick another model.",
  "too-long":
    "This conversation is too long for the model. Start a new conversation, or pick a model that takes more.",
  invalid:
    "The model's provider could not read this request. Start a new conversation, or pick another model.",
  provider: "Could not get an answer from the model. Send your message again.",
};

/**
 * Whether the team hears of a failure: a request the provider could not read
 * is ours to fix, and so is a server error that is not an outage (`isOutage`;
 * a backend we run reports its own, `TurnProfile.reportsOutage`). Everything
 * else is the user's key, model or conversation, or a busy provider, and a
 * resend repeats it, so reporting it would send one event per attempt.
 */
export const isReportedFailure = (
  kind: AiFailureKind,
  status: number | undefined
) => kind === "invalid" || (kind === "provider" && !isOutage(status));

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/ai/failure", () => {
    it.each([
      [429, "busy"],
      [401, "key-refused"],
      [403, "forbidden"],
      [404, "no-model"],
      [413, "too-long"],
      [400, "invalid"],
      [500, "provider"],
      [502, "provider"],
      [undefined, "provider"],
    ])("status %s is %s", (status, kind) => {
      expect(failureKindOf(status, "{}")).toBe(kind);
    });

    it.each([
      '{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 210000 tokens > 200000 maximum"}}',
      '{"error":{"code":"context_length_exceeded","message":"This model\'s maximum context length is 128000 tokens."}}',
      '{"error":{"code":400,"message":"The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).","status":"INVALID_ARGUMENT"}}',
    ])("a 400 past the context is too-long: %s", (body) => {
      expect(failureKindOf(400, body)).toBe("too-long");
    });

    it("reports only what is ours to fix", () => {
      const reported = (Object.keys(FAILURE_MESSAGE) as AiFailureKind[]).filter(
        (kind) => isReportedFailure(kind, 500)
      );
      expect(reported).toEqual(["invalid", "provider"]);
    });

    it.each([502, 503, 504, 529])(
      "an outage (%i) is not reported",
      (status) => {
        expect(isReportedFailure(failureKindOf(status, "{}"), status)).toBe(
          false
        );
      }
    );

    it("a failure with no status is reported", () => {
      expect(isReportedFailure("provider", undefined)).toBe(true);
    });

    it("a 422 is invalid", () => {
      expect(failureKindOf(422, "{}")).toBe("invalid");
    });

    it("Gemini's 400 for a bad key is key-refused", () => {
      const body =
        '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}';
      expect(failureKindOf(400, body)).toBe("key-refused");
    });

    it("never tells the user to resend a request that fails the same way again", () => {
      const resend = (Object.keys(FAILURE_MESSAGE) as AiFailureKind[]).filter(
        (kind) => FAILURE_MESSAGE[kind].includes("Send your message again")
      );
      expect(resend).toEqual(["provider"]);
    });
  });
}
