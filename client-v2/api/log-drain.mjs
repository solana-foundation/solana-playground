import { timingSafeEqual } from "node:crypto";

import { createServerLogger } from "../src/shared/lib/logger/server.mjs";

const log = createServerLogger("api:log-drain");
const MAX_BYTES = 4 * 1024 * 1024;
const SOURCES = new Set(["static", "lambda", "edge", "build", "external"]);
const LEVELS = new Set(["info", "warning", "error", "fatal"]);

/** Vercel NDJSON receiver; labels and JSON fields match Explorer's dashboards. */
export default async function handler(req, res) {
  const verify = process.env.VERCEL_LOG_DRAIN_VERIFY;
  if (verify) res.setHeader("x-vercel-verify", verify);
  res.setHeader("cache-control", "no-store");
  if (req.method === "GET") {
    res.statusCode = 200;
    res.end("playground log drain");
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    res.statusCode = 405;
    res.end();
    return;
  }

  const secret = process.env.VERCEL_DRAIN_SECRET;
  const base = process.env.GRAFANA_LOKI_URL;
  const user = process.env.GRAFANA_LOKI_USER;
  const token = process.env.GRAFANA_LOKI_TOKEN;
  const project = process.env.VERCEL_LOG_DRAIN_PROJECT_ID;
  if (!secret || !base || !user || !token || !project) {
    log.error(new Error("Log drain configuration incomplete"), {
      report: true,
    });
    res.statusCode = 503;
    res.end();
    return;
  }
  const supplied = req.headers["x-vercel-drain-secret"];
  const actual = Buffer.from(typeof supplied === "string" ? supplied : "");
  const expected = Buffer.from(secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    res.statusCode = 403;
    res.end();
    return;
  }

  let body;
  try {
    if (req.body !== undefined) {
      if (typeof req.body === "string" || Buffer.isBuffer(req.body)) {
        body = req.body.toString();
      } else {
        // Vercel can pre-parse application/json; accept its object/array form too.
        const events = Array.isArray(req.body) ? req.body : [req.body];
        body = events.map((event) => JSON.stringify(event)).join("\n");
      }
    } else {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > MAX_BYTES) {
          res.statusCode = 413;
          res.end();
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      body = Buffer.concat(chunks).toString("utf8");
    }
    if (Buffer.byteLength(body) > MAX_BYTES) {
      res.statusCode = 413;
      res.end();
      return;
    }
    const streams = new Map();
    for (const line of body.split("\n")) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event === null || typeof event !== "object" || Array.isArray(event)) {
        throw new Error("Expected log event object");
      }
      // Never ingest the receiver's own requests: those would feed the drain again.
      if (
        event.projectId !== project ||
        event.environment !== "production" ||
        String(event.path ?? "").split("?")[0] === "/api/log-drain" ||
        String(event.proxy?.path ?? "").split("?")[0] === "/api/log-drain"
      ) {
        continue;
      }
      const timestamp = Number(event.timestamp ?? event.timestampInMs);
      if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
        throw new Error("Invalid log event timestamp");
      }
      const source = SOURCES.has(event.source) ? event.source : "unknown";
      const level = LEVELS.has(event.level) ? event.level : "info";
      const key = `${source}:${level}`;
      if (!streams.has(key)) {
        streams.set(key, {
          stream: { service: "playground", env: "prd", source, level },
          values: [],
        });
      }
      streams
        .get(key)
        .values.push([
          String(BigInt(timestamp) * 1000000n),
          JSON.stringify(event),
        ]);
    }
    body = JSON.stringify({ streams: Array.from(streams.values()) });
    if (!streams.size) {
      res.statusCode = 204;
      res.end();
      return;
    }
  } catch {
    log.warn("Rejected malformed log-drain batch");
    res.statusCode = 400;
    res.end();
    return;
  }

  try {
    const url = new URL(base);
    if (url.protocol !== "https:") throw new Error("Loki requires HTTPS");
    url.pathname = "/loki/api/v1/push";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${user}:${token}`).toString(
          "base64"
        )}`,
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Loki push returned ${response.status}`);
    res.statusCode = 204;
  } catch {
    // Do not include request bodies, credentials, or an upstream error body in logs.
    log.error(new Error("Loki push failed; Vercel must retry"), {
      report: true,
    });
    res.statusCode = 502;
  }
  res.end();
}
