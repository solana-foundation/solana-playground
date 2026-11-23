/**
 * What this feature offers a server route. The one door into it.
 *
 * `index.ts` is the same thing for the browser; this is its counterpart for
 * `api/*.mjs`, which Vercel executes as plain ESM with no build step -- hence
 * `.mjs` rather than `.ts`. See `features/persistence/server.mjs` for the
 * reasoning in full.
 */
export {
  ACCOUNT_OPTIONS,
  getAuth,
  isAllowedOrigin,
  missingConfig,
  readSession,
  requireUser,
} from "./model/auth.mjs";
export {
  NoGithubGrant,
  readGithubToken,
  readGithubTokenWith,
} from "./model/github-token.mjs";
export {
  AUTH_CHANNEL_NAME,
  AUTH_MESSAGE_TYPE,
  AUTH_NOT_CONFIGURED,
  SIGNED_OUT_REASON,
} from "./config.mjs";
