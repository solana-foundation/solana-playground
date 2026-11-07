import { SIGNED_OUT_REASON } from "@/features/auth";

/**
 * Whether a thrown error is the build server's refusal for sign-in.
 * `/api/build-server` (HOO-2422, foundation PR 119) answers a signed-out build with
 * `reason: "signed-out"`, and `PgServerRequestError` carries it from there;
 * until that lands no error has the field, so this reads it off any error
 * rather than narrowing to the class. A feature may not import `auth`, so the
 * slices that must tell it apart ask here.
 *
 * @param e what the build threw
 */
export const isSignInRefusalError = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  (e as { reason?: unknown }).reason === SIGNED_OUT_REASON;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("utils/sign-in-refusal", () => {
    it("tells a refusal for sign-in from any other error", () => {
      const refused = Object.assign(
        new Error("Sign in with GitHub to build."),
        {
          reason: "signed-out",
        }
      );
      expect(isSignInRefusalError(refused)).toBe(true);
      expect(isSignInRefusalError(new Error("Invalid path"))).toBe(false);
      expect(
        isSignInRefusalError(Object.assign(new Error("x"), { reason: "other" }))
      ).toBe(false);
      expect(isSignInRefusalError("signed-out")).toBe(false);
      expect(isSignInRefusalError(undefined)).toBe(false);
    });
  });
}
