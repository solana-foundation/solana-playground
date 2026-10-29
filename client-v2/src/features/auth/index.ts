// Public API of the slice: import from here, never from its internals.
// Names are deliberately un-prefixed - the slice should not know the naming
// convention of the app consuming it. Callers alias to `Pg*` at the import.
import { PgSession } from "./model/session";

export { isSignInFailure, PgSession } from "./model/session";
export type { ReadState, SessionUser, SignInState } from "./model/session";
export type { SignInFailure } from "./model/telemetry";
export { SIGNED_OUT_REASON } from "./config.mjs";

/**
 * Command pre-check: the airdrop demo requires an identity.
 *
 * Replaces `checkGithubSignIn`, which gated on a reload-scoped in-memory
 * token. This gates on the persisted session instead, so the check survives a
 * refresh the way users expect.
 */
export const checkSignedIn = () => {
  if (!PgSession.get()) {
    throw new Error("Sign in with GitHub to request devnet SOL.");
  }
};

if (import.meta.vitest) {
  const { describe, it, expect, afterEach } = import.meta.vitest;

  describe("features/auth/index", () => {
    describe("checkSignedIn", () => {
      afterEach(() => PgSession.reset());

      it("throws for a signed-out user, so the airdrop command stops", () => {
        expect(() => checkSignedIn()).toThrow(/sign in with github/i);
      });

      it("passes once a session exists", async () => {
        await PgSession.refreshWith({
          id: "u1",
          name: "Ada",
          image: null,
          login: "ada",
        });

        expect(() => checkSignedIn()).not.toThrow();
      });
    });
  });
}
