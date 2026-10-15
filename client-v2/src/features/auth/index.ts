// Public API of the slice: import from here, never from its internals.
// Names are deliberately un-prefixed - the slice should not know the naming
// convention of the app consuming it. Callers alias to `Pg*` at the import.
import { PgSession } from "./model/session";

export { PgSession } from "./model/session";
export type { SessionUser } from "./model/session";

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
