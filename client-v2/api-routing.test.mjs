/**
 * Every `/api` path the browser calls must be served by something on the
 * platform -- a file, or a rewrite that reaches one.
 *
 * Vercel's zero-config `api/` routing is narrower than it looks. Each file
 * becomes exactly one route, and a bracketed segment -- `[id]` and `[...all]`
 * alike -- compiles to `([^/]+)`, which matches a single segment.
 * `createRouteFromPath` in `@vercel/fs-detectors` has no catch-all case at all.
 * So no file under `api/` can serve a subtree, and `/api/auth/sign-in/social`
 * (two segments below `/api/auth`) is unreachable by file name however it is
 * spelled. A `vercel.json` rewrite is the mechanism that does span segments,
 * which is how the Better Auth subtree gets served.
 *
 * None of this shows up locally: the dev server dispatches on the first path
 * segment (`resolveApiRoute` in `craco.config.js`), so it serves a subtree the
 * deployment cannot. Only the deployed rules can tell us the truth, so this
 * asserts against them rather than against a running server.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = path.dirname(fileURLToPath(import.meta.url));

/** Every route file, as paths below `api/` */
const apiFiles = (dir = "api") =>
  readdirSync(path.join(root, dir)).flatMap((entry) => {
    const rel = path.join(dir, entry);
    if (statSync(path.join(root, rel)).isDirectory()) return apiFiles(rel);
    return entry.endsWith(".mjs") && !entry.endsWith(".test.mjs") ? [rel] : [];
  });

/**
 * The route a file answers, by Vercel's rule: drop the extension, and let a
 * bracketed segment stand for one segment -- never more.
 *
 * @param {string} file e.g. `api/auth/[provider].mjs`
 * @returns {RegExp} what the platform would match it against
 */
const fileRoute = (file) => {
  const pattern = file
    .replace(/\.mjs$/, "")
    .split("/")
    .map((segment) =>
      segment.startsWith("[")
        ? "[^/]+"
        : segment.replace(/[.*+?^${}()|\\]/g, "\\$&")
    )
    .join("/");
  return new RegExp(`^/${pattern}$`);
};

/**
 * `vercel.json` rewrites, as regexes.
 *
 * Covers the two source forms this project uses: a raw regex (the SPA
 * fallback) and a trailing `:name+` / `:name*` parameter, which
 * `@vercel/routing-utils` compiles to a multi-segment capture. Anything else
 * would need the real compiler.
 */
const rewriteRoute = (source) => {
  if (!source.includes(":")) return new RegExp(`^${source}$`);
  const pattern = source
    .replace(/\/:[A-Za-z0-9_]+\+$/, "/.+")
    .replace(/\/:[A-Za-z0-9_]+\*$/, "(?:/.+)?");
  return new RegExp(`^${pattern}$`);
};

const { rewrites } = JSON.parse(
  readFileSync(path.join(root, "vercel.json"), "utf8")
);
const files = apiFiles();

/** Whether the deployment answers a path with a function, directly or after a rewrite */
const isServed = (urlPath) => {
  if (files.some((file) => fileRoute(file).test(urlPath))) return true;

  for (const { source, destination } of rewrites) {
    if (!rewriteRoute(source).test(urlPath)) continue;
    const dest = destination.split("?")[0];
    return files.some((file) => fileRoute(file).test(dest));
  }
  return false;
};

/** What the app actually calls. Better Auth's own routes are the nested ones. */
const CALLED_PATHS = [
  "/api/agent",
  "/api/auth-complete",
  "/api/auth/callback/github",
  "/api/auth/get-session",
  "/api/auth/sign-in/social",
  "/api/auth/sign-out",
  "/api/conversations",
  "/api/health",
  "/api/mcp",
  "/api/projects",
  "/api/sync",
];

describe("deployed API routing", () => {
  for (const urlPath of CALLED_PATHS) {
    it(`serves ${urlPath}`, () => {
      assert.ok(
        isServed(urlPath),
        `Nothing on the platform answers ${urlPath}: no file under api/ ` +
          `matches it and no rewrite in vercel.json reaches one`
      );
    });
  }

  it("keeps the SPA rewrite off /api, so a miss is a 404 and not index.html", () => {
    for (const { source, destination } of rewrites) {
      if (destination === "/index.html") {
        assert.doesNotMatch(
          "/api/auth/sign-in/social",
          rewriteRoute(source),
          `${source} swallows /api paths into the SPA fallback`
        );
      }
    }
  });
});
