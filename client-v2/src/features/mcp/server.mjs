/**
 * What this feature offers a server route. The one door into it.
 *
 * `index.ts` is the same thing for the browser; this is its counterpart for
 * `api/*.mjs`, which Vercel executes as plain ESM with no build step. See
 * `features/persistence/server.mjs` for the reasoning in full.
 */
export { composeServers } from "./model/compose.mjs";
export { protectionHeaders } from "./model/protection.mjs";
