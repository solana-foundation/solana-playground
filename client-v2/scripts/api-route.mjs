// Serves `api/*.mjs` outside Vercel: the dev server mounts `serveApiRoute`
// through `craco.config.js`, the production bundle through `serve-build.mjs`.

/** Answer as the platform would, not as the SPA fallback would */
const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

/**
 * Map an `/api` sub-path to the module that serves it.
 *
 * Only the first segment selects the module, so `api/auth.mjs` serves every
 * `/api/auth/...` path -- which on the platform takes a `vercel.json` rewrite,
 * because no `api/` file name spans segments (see `api-routing.test.mjs`).
 * Every segment is still constrained rather than sanitised, because the value
 * reaches `import()`.
 *
 * @param {string} url the path below `/api`, query string included
 * @returns {{name: string} | null} the module to import, or `null` for 404
 */
export const resolveApiRoute = (url) => {
  const segments = url.split("?")[0].split("/").filter(Boolean);
  if (!segments.length) return null;
  if (
    !segments.every(
      (s) => /^[A-Za-z0-9._-]+$/.test(s) && s !== ".." && s !== "."
    )
  ) {
    return null;
  }

  const [name] = segments;
  return /^[a-z0-9-]+$/.test(name) ? { name } : null;
};

/**
 * Dispatch `/api/<name>` to `api/<name>.mjs`, matching how the deployed
 * function is invoked.
 *
 * Never calls `next()`: falling through would hand an unknown `/api` path to
 * the history fallback, which answers `200 text/html` with `index.html` and
 * shows up in a client as `Unexpected token '<'`. A 404 is both the truth and
 * what the deployment does.
 *
 * @param {import("http").IncomingMessage & {url: string}} req mounted on
 *   `/api`: `req.url` is the remainder, `req.originalUrl` the whole path
 * @param {import("http").ServerResponse} res
 */
export const serveApiRoute = async (req, res) => {
  // NOTE: the `import()` below caches, and nothing here invalidates it. Editing
  // an `api/*.mjs` route, or a `.mjs` one of them imports (the per-feature
  // `config.mjs` files), does NOT hot-reload the way `src` does -- the server
  // keeps serving the module it first loaded, and a newly added export shows up
  // as "does not provide an export named X". Restart the dev server after such
  // an edit.
  const route = resolveApiRoute(req.url);
  if (!route) {
    return sendJson(res, 404, { error: `No API route at /api${req.url}` });
  }

  try {
    const mod = await import(
      new URL(`../api/${route.name}.mjs`, import.meta.url).href
    );
    await mod.default(req, res);
  } catch (e) {
    if (e.code === "ERR_MODULE_NOT_FOUND") {
      return sendJson(res, 404, {
        error: `No API route at /api/${route.name}`,
      });
    }
    sendJson(res, 500, { error: e.message });
  }
};
