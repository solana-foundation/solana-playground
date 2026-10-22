// Serves the production bundle in `build/` and `api/*.mjs` the way
// `vercel.json` routes them, for the compose `client-v2-prod` service.
// A local stand-in for the platform, not a production server.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { serveApiRoute } from "./api-route.mjs";

const CLIENT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** Content types by extension; anything else is served as bytes */
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".rs": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".toml": "text/plain; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

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
    spaFallback: spa ? new RegExp(`^${spa.source}$`) : null,
  };
};

/**
 * What answers a request path, in the platform's order: the API, a file in
 * `buildDir`, the SPA fallback, then nothing.
 *
 * @param {string} pathname decoded, as `URL` normalises it
 * @param {{buildDir: string, spaFallback: RegExp | null,
 *   isFile: (file: string) => boolean}} options
 * @returns {{kind: "api"} | {kind: "file", file: string} | {kind: "missing"}}
 */
export const resolveRequest = (pathname, { buildDir, spaFallback, isFile }) => {
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return { kind: "api" };
  }
  const file = path.join(buildDir, pathname);
  if (file.startsWith(buildDir + path.sep) && isFile(file)) {
    return { kind: "file", file };
  }
  if (spaFallback?.test(pathname)) {
    return { kind: "file", file: path.join(buildDir, "index.html") };
  }
  return { kind: "missing" };
};

const isFile = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return false;
    throw e;
  }
};

const sendFile = (req, res, file) => {
  res.setHeader(
    "content-type",
    CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream"
  );
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file)
    .on("error", (e) => {
      console.error(`serve-build: reading ${file} failed:`, e);
      if (res.headersSent) return res.destroy(e);
      res.statusCode = 500;
      res.end();
    })
    .pipe(res);
};

/**
 * @param {{buildDir: string, config: object}} options `config` is `vercel.json`
 * @returns {http.Server}
 */
export const createServer = ({ buildDir, config }) => {
  const { headers, spaFallback } = platformRules(config);
  return http.createServer((req, res) => {
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }

    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(req.url ?? "/", "http://localhost").pathname
      );
    } catch {
      // Malformed percent-encoding names no file; say so rather than guess one.
      res.statusCode = 400;
      return res.end();
    }

    const target = resolveRequest(pathname, { buildDir, spaFallback, isFile });
    if (target.kind === "api") {
      // As Express mounts `serveApiRoute` in the dev server: the remainder in
      // `url`, the whole path in `originalUrl`, which Better Auth routes on.
      req.originalUrl = req.url;
      req.url = req.url.slice("/api".length) || "/";
      return serveApiRoute(req, res);
    }
    if (target.kind === "file") return sendFile(req, res, target.file);
    res.statusCode = 404;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Not found");
  });
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const buildDir = path.join(CLIENT_DIR, "build");
  if (!isFile(path.join(buildDir, "index.html"))) {
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
