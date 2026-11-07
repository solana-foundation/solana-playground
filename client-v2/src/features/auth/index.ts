// Public API of the slice: import from here, never from its internals.
// Names are deliberately un-prefixed - the slice should not know the naming
// convention of the app consuming it. Callers alias to `Pg*` at the import.
import { PgSession } from "./model/session";

export {
  isSignInFailure,
  PgSession,
  SIGN_IN_FAILED_UNKNOWN,
} from "./model/session";
export type { ReadState, SessionUser, SignInState } from "./model/session";
export type { SignInFailure } from "./model/telemetry";
export { SIGNED_OUT_REASON } from "./config.mjs";
export { useSignedIn } from "./model/use-signed-in";

/**
 * Command pre-check: throws while signed out. The airdrop runs it only where
 * the faucet is public (`isAirdropSignInGated`); a local validator funds a
 * signed-out user. It reads the persisted session, so it survives a refresh.
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
        expect(() => checkSignedIn()).toThrow(
          "Sign in with GitHub to request devnet SOL."
        );
      });

      it("passes once a session exists", async () => {
        await PgSession.refreshWith({
          id: "u1",
          name: "Ada",
          image: undefined,
          login: "ada",
        });

        expect(() => checkSignedIn()).not.toThrow();
      });
    });
  });
}
