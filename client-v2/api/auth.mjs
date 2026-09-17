/**
 * Better Auth's catch-all. Every `/api/auth/...` path lands here.
 *
 * The dev server dispatches on the first path segment (see `resolveApiRoute`
 * in `craco.config.js`), which is how one module serves a whole subtree both
 * locally and on the platform.
 */
import { toNodeHandler } from "better-auth/node";

import { getAuth } from "../src/features/auth/server/auth.mjs";

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
export default async function handler(req, res) {
  const auth = getAuth();
  if (!auth) {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    return res.end(
      JSON.stringify({ error: "Authentication is not configured" })
    );
  }

  return toNodeHandler(auth)(req, res);
}
