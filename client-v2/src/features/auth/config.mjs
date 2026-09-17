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
 * How long the browser waits for the popup to answer, in seconds.
 *
 * The popup cannot be polled once GitHub has taken it over -- `popup.closed`
 * lies after a COOP hop -- so this bound and an explicit cancel are the only
 * ways the wait ends without an answer.
 */
export const FLOW_MAX_AGE_SECONDS = 600;
