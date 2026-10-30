// Values shared by both halves of the feature: the browser model under `src`
// and the serverless handlers under `api`, which are plain ESM outside the TS
// build (see api/health.mjs). `.mjs` so Node can import it directly; `allowJs`
// lets the TypeScript side import the same file rather than restate it.
//
// Sign-in runs in a popup rather than a navigation. Better Auth *returns* the
// authorize URL instead of redirecting to it, so the caller chooses -- and a
// navigation would drop everything the editor holds in memory.
//
// Nothing secret travels on the channel below. Better Auth sets an HttpOnly
// session cookie on our origin during its own callback, and cookies are
// per-origin rather than per-window, so by the time the popup reports back the
// opener can already read the session. The message only says "finished".

/** Where Better Auth sends the popup once the session cookie is set */
export const AUTH_COMPLETE_ROUTE = "/api/auth-complete";

/** Discriminates our reply from anything else on the page */
export const AUTH_MESSAGE_TYPE = "pg-auth-complete";

/** Names both the popup window and the BroadcastChannel fallback */
export const AUTH_CHANNEL_NAME = "pg-auth-complete";

/**
 * `error` on the 503 the auth route answers when this deployment has no
 * sign-in configured: an answer, not a failure, since nobody can be signed in.
 * The browser matches this exact string (`notConfigured` in the session model).
 */
export const AUTH_NOT_CONFIGURED = "Authentication is not configured";

/** `reason` on a 401 from a route that needs a session, so the browser can tell it from any other 401 */
export const SIGNED_OUT_REASON = "signed-out";

/**
 * The variables sign-in cannot run without. `missingConfig` reports these, and
 * `scripts/check-agent-env.mjs` fails a Vercel build that sets the agent key
 * without them, since `/api/agent` would refuse every turn.
 */
export const SIGN_IN_ENV = [
  "DATABASE_URL",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "AUTH_SECRET",
];

/**
 * How long the browser waits for the popup to answer, in seconds.
 *
 * The popup cannot be polled once GitHub has taken it over -- `popup.closed`
 * lies after a COOP hop -- so this bound and an explicit cancel are the only
 * ways the wait ends without an answer.
 */
export const FLOW_MAX_AGE_SECONDS = 600;

/**
 * How long the browser waits for a sign-out to answer, in milliseconds.
 *
 * Long enough for a slow network; a hung request otherwise never answers.
 */
export const SIGN_OUT_TIMEOUT_MS = 15_000;
