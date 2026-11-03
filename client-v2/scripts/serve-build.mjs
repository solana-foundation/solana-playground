// Serves the production bundle in `build/` and `api/*.mjs` the way
// `vercel.json` routes them, for the compose `client-v2-prod` service.
// A local stand-in for the platform, not a production server: Vercel serves
// every deployment. Temporary, until client-v2 moves to Next.js, whose own
// server serves the bundle and the API routes.

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { serveApiRoute } from "./api-route.mjs";

const CLIENT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** Headers for every path, from the one `vercel.json` source this server mirrors */
const ALL_PATHS = "/(.*)";

/**
 * What `vercel.json` asks of this server: the headers on every response and
 * the SPA fallback. Throws on a header rule for another source, which would
 * otherwise be dropped without a word.
 *
 * @param {{headers?: {source: string, headers: {key: string, value: string}[]}[],
 *   rewrites?: {source: string, destination: string}[]}} config
 */
export const platformRules = (config) => {
  const headers = {};
  for (const rule of config.headers ?? []) {
    if (rule.source !== ALL_PATHS) {
      throw new Error(
        `serve-build: vercel.json sets headers for ${rule.source}; only ${ALL_PATHS} is mirrored`
      );
    }
    for (const { key, value } of rule.headers) headers[key] = value;
  }
  const spa = (config.rewrites ?? []).find(
    (r) => r.destination === "/index.html"
  );
  return {
    headers,
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
  const { headers, spaFallback } = platformRules(config);
  const app = express();
  app.use((req, res, next) => {
    res.set(headers);
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
