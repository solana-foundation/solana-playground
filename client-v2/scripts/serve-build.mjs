// Serves the production bundle in `build/` and `api/*.mjs` the way
// `vercel.json` routes them, for the compose `client-v2-prod` service.
// A local stand-in for the platform, not a production server: Vercel serves
// every deployment. Temporary, until client-v2 moves to Next.js, whose own
// server serves the bundle and the API routes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import { serveApiRoute } from "./api-route.mjs";

const CLIENT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** The one pattern a mirrored header source may end with: the rest of the path */
const REST_OF_PATH = "(.*)";

/**
 * A `vercel.json` header source as a matcher of request paths: a literal
 * path, optionally ending in `(.*)`. Throws on any other pattern (`:param`,
 * other groups), which this server would otherwise mismatch without a word.
 *
 * @param {string} source
 * @returns {RegExp}
 */
const matcherOf = (source) => {
  const literal = source.endsWith(REST_OF_PATH)
    ? source.slice(0, -REST_OF_PATH.length)
    : source;
  if (!/^\/[\w./-]*$/.test(literal)) {
    throw new Error(
      `serve-build: vercel.json sets headers for ${source}, a source this server cannot match`
    );
  }
  const escaped = literal.replaceAll(".", "\\.");
  return new RegExp(`^${escaped}${literal === source ? "" : ".*"}$`);
};

/** A hostname with no pattern in it: the only host condition this server reads */
const PLAIN_HOST = /^[\w-]+(\.[\w-]+)*$/;

/**
 * A `vercel.json` `has` or `missing` list as a test of the request's host:
 * equal to the value, ignoring case. Vercel reads the value as a pattern, so
 * this server takes only a plain hostname, where the two agree, and throws on
 * a pattern or any other condition type (`header`, `cookie`, `query`), which it
 * would otherwise misapply without a word.
 *
 * @param {{type: string, value?: string}[] | undefined} conditions
 * @param {string} source the rule's source, named in the error
 * @returns {((host: string) => boolean)[]}
 */
const hostMatchersOf = (conditions, source) =>
  (conditions ?? []).map((condition) => {
    if (
      condition.type !== "host" ||
      condition.value === undefined ||
      !PLAIN_HOST.test(condition.value)
    ) {
      throw new Error(
        `serve-build: vercel.json conditions headers for ${source} on ${
          condition.type
        } ${condition.value ?? ""}, which this server cannot match`
      );
    }
    const expected = condition.value.toLowerCase();
    return (host) => host.toLowerCase() === expected;
  });

/**
 * What `vercel.json` asks of this server: the headers each path on each host
 * gets, every matching rule's in order, and the SPA fallback.
 *
 * @param {{headers?: {source: string, has?: {type: string, value?: string}[],
 *   missing?: {type: string, value?: string}[],
 *   headers: {key: string, value: string}[]}[],
 *   rewrites?: {source: string, destination: string}[]}} config
 * @returns {{headersFor: (urlPath: string, host: string) => Record<string, string>,
 *   spaFallback: RegExp | undefined}}
 */
export const platformRules = (config) => {
  const rules = (config.headers ?? []).map((rule) => ({
    matcher: matcherOf(rule.source),
    has: hostMatchersOf(rule.has, rule.source),
    missing: hostMatchersOf(rule.missing, rule.source),
    headers: rule.headers,
  }));
  const appliesTo = (rule, host) =>
    rule.has.every((matches) => matches(host)) &&
    !rule.missing.some((matches) => matches(host));
  const spa = (config.rewrites ?? []).find(
    (r) => r.destination === "/index.html"
  );
  return {
    headersFor: (urlPath, host) => {
      const headers = {};
      for (const rule of rules) {
        if (!rule.matcher.test(urlPath) || !appliesTo(rule, host)) continue;
        for (const { key, value } of rule.headers) headers[key] = value;
      }
      return headers;
    },
    spaFallback: spa ? new RegExp(`^${spa.source}$`) : undefined,
  };
};

/**
 * In the platform's order: the API, a file in `buildDir`, the SPA fallback,
 * then a 404. `/api/auth/...` needs no rewrite of its own: `serveApiRoute`
 * dispatches on the first segment below `/api`.
 *
 * @param {{buildDir: string, config: object}} options `config` is `vercel.json`
 * @returns {import("express").Express}
 */
export const createServer = ({ buildDir, config }) => {
  const { headersFor, spaFallback } = platformRules(config);
  const app = express();
  app.use((req, res, next) => {
    res.set(headersFor(req.path, req.hostname));
    next();
  });
  // Mounted as the dev server mounts it: the remainder in `url`, the whole path in `originalUrl`.
  app.use("/api", serveApiRoute);
  app.use(express.static(buildDir));
  if (spaFallback) {
    app.get(spaFallback, (req, res) =>
      res.sendFile(path.join(buildDir, "index.html"))
    );
  }
  app.use((req, res) => res.status(404).type("text/plain").send("Not found"));
  return app;
};

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const buildDir = path.join(CLIENT_DIR, "build");
  if (!fs.existsSync(path.join(buildDir, "index.html"))) {
    console.error(
      `serve-build: ${buildDir} has no index.html; run yarn build:bundle`
    );
    process.exit(1);
  }
  const config = JSON.parse(
    fs.readFileSync(path.join(CLIENT_DIR, "vercel.json"), "utf8")
  );
  const port = Number(process.env.PORT ?? 3000);
  createServer({ buildDir, config }).listen(port, () => {
    console.log(`serve-build: ${buildDir} on http://localhost:${port}`);
  });
}
