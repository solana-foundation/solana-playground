/** A build server on this machine -- upstream's development default */
export const LOCAL_ENDPOINT = "http://localhost:8080";

/** The Solana Foundation's own deployment, and what a fresh profile uses */
export const FOUNDATION_ENDPOINT =
  "https://playground-server-dot-analytics-324114.de.r.appspot.com";

/**
 * Upstream's original backend. Reachable on purpose and never a default
 * (D30): a user who picks it accepts that it is Acheron's capacity, not
 * Solana's, and the label says which one it is.
 */
export const SOLPG_ENDPOINT = "https://api.solpg.io";

/**
 * What the picker offers, in this order -- the default first. The custom
 * URL field comes after these, from the setting itself.
 */
export const SERVER_ENDPOINT_OPTIONS: ReadonlyArray<{
  name: string;
  value: string;
}> = [
  { name: "Solana Foundation", value: FOUNDATION_ENDPOINT },
  { name: "Local", value: LOCAL_ENDPOINT },
  { name: "SolPg (original backend)", value: SOLPG_ENDPOINT },
];

/**
 * Which build server a fresh profile talks to.
 *
 * The Foundation's server in every environment, development included.
 * Upstream defaults development to a local server, but nothing in this
 * repository starts one, so the first build of a fresh checkout used to
 * fail in milliseconds against a port with nothing behind it; the
 * Foundation's server allowlists `localhost:3000`, so development can
 * reach it directly. Running a server locally is a picker entry away, or
 * `REACT_APP_SERVER_URL=http://localhost:8080`.
 *
 * `||` not `??`: sourcing an env file leaves unfilled keys as "", which is
 * not nullish and would win.
 *
 * This decides the default only. A profile stores the option it picked,
 * not the address (`settings/stored-endpoint.ts`): one on this default
 * follows `REACT_APP_SERVER_URL` when it changes, and one that picked
 * another option keeps that option.
 */
export const defaultServerEndpoint = (env: {
  REACT_APP_SERVER_URL?: string;
  NODE_ENV?: string;
}) => env.REACT_APP_SERVER_URL || FOUNDATION_ENDPOINT;
