/**
 * Better Auth's catch-all. Every `/api/auth/...` path lands here.
 *
 * Not by file name: Vercel's zero-config `api/` routing gives each file
 * exactly one route, and a bracketed segment -- `[id]`, `[...all]`, it makes no
 * difference -- compiles to `([^/]+)`, a single segment. No file can serve a
 * subtree, so `/api/auth/sign-in/social` is unreachable however it is spelled.
 * `vercel.json` rewrites the subtree here instead, which is the one mechanism
 * that spans segments. `api-routing.test.mjs` holds the rule.
 *
 * The dev server arrives the other way, dispatching on the first path segment
 * (see `resolveApiRoute` in `craco.config.js`).
 */
import { toNodeHandler } from "better-auth/node";

import { getAuth, missingConfig } from "../src/features/auth/server.mjs";
import { warnAboutMissingObservabilityIds } from "../src/features/api/server/observability.mjs";
import { withObservability } from "../src/features/api/server/with-observability.mjs";

/**
 * Put the requested path back on the request.
 *
 * Better Auth routes on the path alone and 404s anything that is not below its
 * `/api/auth` base, so what the rewrite did with the sub-path matters. The
 * rewrite carries it in `authPath` (Vercel appends the captured parameter to
 * the destination query), which is the one copy we know arrives -- a rewritten
 * request may reach the function under the destination path rather than the
 * one the browser asked for.
 *
 * Rebuilding from the hint is idempotent: when the original path did survive,
 * this writes back what is already there.
 *
 * @param {import("node:http").IncomingMessage} req
 */
export const restorePath = (req) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const subPath = url.searchParams.get("authPath");
  if (!subPath) return;

  url.searchParams.delete("authPath");
  req.url = `/api/auth/${subPath}${url.search}`;
};

/**
 * Exported for tests only; `handler` below is the route.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
async function handler(req, res) {
  warnAboutMissingObservabilityIds();
  const auth = getAuth();
  if (!auth) {
    // `missing` names the variables this deployment lacks. Every deployment
    // carries its own environment and none of it is visible from the outside,
    // so without this the only way to tell a misconfigured preview from a
    // broken one is another deploy. See `missingConfig` for why the names are
    // safe to say out loud.
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    return res.end(
      JSON.stringify({
        error: "Authentication is not configured",
        missing: missingConfig(),
      })
    );
  }

  restorePath(req);
  return toNodeHandler(auth)(req, res);
}

export default withObservability("auth", handler);
