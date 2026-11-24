/**
 * An error that says it is its own message, such as a sign-in refusal
 * (`PgServerError.isPlain`) or accounts held by a running deploy
 * (`AccountsHeldError`): shown as it is, never reported as a failure.
 */
export const isPlainRefusal = (error: unknown): error is Error =>
  error instanceof Error && (error as { isPlain?: unknown }).isPlain === true;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/plain-refusal", () => {
    it("reads an error marked isPlain as a plain refusal", () => {
      const error = Object.assign(new Error("Held"), { isPlain: true });
      expect(isPlainRefusal(error)).toBe(true);
    });

    it("reads anything else as not one", () => {
      expect(isPlainRefusal(new Error("Broke"))).toBe(false);
      expect(isPlainRefusal({ isPlain: true })).toBe(false);
    });
  });
}
