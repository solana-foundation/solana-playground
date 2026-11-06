/**
 * What `/api/build-server` forwards, and what it reads off a request.
 *
 * The route is a base URL to the client: `PgServer` joins its usual paths
 * onto it. Only the paths the client calls are forwarded, so the route cannot
 * be used to reach anything else the build server serves (sharing, bundling).
 */

/** The client's calls, each with its one method */
const ROUTES = [
  { pattern: /^\/build$/, method: "POST", kind: "build" },
  // One segment, no dot segment; the route checks it is a UUID, since only
  // `api/` may import the `uuid` package (client-v2/CLAUDE.md, ids)
  { pattern: /^\/deploy\/(?<id>[^/.][^/]*)$/, method: "GET", kind: "deploy" },
];

/** Longest project id or name the audit keeps */
export const MAX_PROJECT_FIELD = 200;

/**
 * @param {string} method
 * @param {string} path the path below the route, e.g. `/build`
 * @returns {{ ok: true; kind: "build"; unstable: boolean }
 *   | { ok: true; kind: "deploy"; unstable: boolean; programId: string }
 *   | { ok: false; status: 404 }
 *   | { ok: false; status: 405; allow: string }}
 */
export const resolveRoute = (method, path) => {
  const unstable = path.startsWith("/unstable/");
  const rest = unstable ? path.slice("/unstable".length) : path;

  const route = ROUTES.find((r) => r.pattern.test(rest));
  if (!route) return { ok: false, status: 404 };
  if (method !== route.method) {
    return { ok: false, status: 405, allow: route.method };
  }
  const programId = route.pattern.exec(rest)?.groups?.id;
  return programId === undefined
    ? { ok: true, kind: route.kind, unstable }
    : { ok: true, kind: route.kind, unstable, programId };
};

/**
 * The path to forward, from either way a request arrives: on Vercel the
 * `vercel.json` rewrite carries it in `?path=`; under the dev server
 * (`scripts/api-route.mjs`) it is the URL below `/api`, route name first.
 * The rewrite's parameter arrives decoded, so `%2F..%2F` is checked as
 * `/../` by {@link resolveRoute}, whose patterns admit no dot segment; a
 * pathname stays encoded, and an encoded segment matches no pattern either.
 *
 * @param {string} url `req.url`
 * @returns {string | undefined}
 */
export const upstreamPath = (url) => {
  const parsed = new URL(url, "http://localhost");
  const rest = parsed.pathname.replace(/^(\/api)?\/build-server(?=\/|$)/, "");
  if (rest) return rest;
  // Only the bare route reads `?path=`, so a caller's own `?path=` on a full
  // path cannot stand in for it
  if (!parsed.searchParams.has("path")) return undefined;
  const hinted = parsed.searchParams.getAll("path");
  if (hinted.length !== 1) return undefined;
  return `/${hinted[0].replace(/^\/+/, "")}`;
};

/** @param {unknown} v */
const capped = (v) =>
  typeof v === "string" ? v.slice(0, MAX_PROJECT_FIELD) : undefined;

/**
 * The project a build request says it belongs to. The client's claim, kept
 * for the audit; nothing is decided by it.
 *
 * @param {unknown} json the parsed request body
 * @returns {{ id?: string; name?: string }}
 */
export const projectOf = (json) => {
  const project =
    json && typeof json === "object"
      ? /** @type {any} */ (json).project
      : undefined;
  if (!project || typeof project !== "object") {
    return { id: undefined, name: undefined };
  }
  return { id: capped(project.id), name: capped(project.name) };
};
