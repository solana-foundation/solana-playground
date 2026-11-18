/**
 * How long a busy build server asked the caller to wait, in seconds, or
 * `undefined` when the error is no such refusal. `/api/build-server` answers
 * `429` when the user is past a build limit (HOO-2907) and `503` when the
 * build server's queue is full (HOO-2908), each with `Retry-After`; the
 * header is what makes it a busy refusal, so a `503` without one (sign-in
 * unavailable, no build server configured) stays an ordinary failure. Read
 * off any error by shape, like `isSignInRefusalError`, so a test double or a
 * rethrown copy still reads as one.
 *
 * @param e what the build threw
 */
export const getBusyRetryAfter = (e: unknown): number | undefined => {
  if (typeof e !== "object" || e === null) return undefined;
  const { status, retryAfterSeconds } = e as {
    status?: unknown;
    retryAfterSeconds?: unknown;
  };
  if (status !== 429 && status !== 503) return undefined;
  return typeof retryAfterSeconds === "number" ? retryAfterSeconds : undefined;
};

/**
 * Whether a thrown error is a refusal because the build service is busy
 *
 * @param e what the build threw
 */
export const isBusyRefusalError = (e: unknown): boolean =>
  getBusyRetryAfter(e) !== undefined;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("utils/busy-refusal", () => {
    const refused = (status: number, retryAfterSeconds: number | undefined) =>
      Object.assign(new Error("busy"), { status, retryAfterSeconds });

    it("reads a 429 or a 503 that says when to retry", () => {
      expect(getBusyRetryAfter(refused(429, 30))).toBe(30);
      expect(getBusyRetryAfter(refused(503, 5))).toBe(5);
      expect(isBusyRefusalError(refused(429, 0))).toBe(true);
    });

    it("leaves a 503 or a 429 with no Retry-After as an ordinary failure", () => {
      expect(isBusyRefusalError(refused(503, undefined))).toBe(false);
      expect(isBusyRefusalError(refused(429, undefined))).toBe(false);
    });

    it("leaves every other status and value alone", () => {
      expect(isBusyRefusalError(refused(502, 5))).toBe(false);
      expect(isBusyRefusalError(new Error("x"))).toBe(false);
      expect(isBusyRefusalError("429")).toBe(false);
      expect(isBusyRefusalError(undefined)).toBe(false);
    });
  });
}
