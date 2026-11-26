import assert from "node:assert/strict";
import { PassThrough, Readable } from "node:stream";
import { after, afterEach, beforeEach, mock, test } from "node:test";

import {
  initServerLogger,
  resetServerLogger,
} from "../src/shared/lib/logger/server.mjs";
import handler from "./log-drain.mjs";

const keys = [
  "VERCEL_ENV",
  "REACT_APP_SENTRY_DSN",
  "VERCEL_DRAIN_SECRET",
  "GRAFANA_LOKI_URL",
  "GRAFANA_LOKI_USER",
  "GRAFANA_LOKI_TOKEN",
  "VERCEL_LOG_DRAIN_PROJECT_ID",
  "VERCEL_LOG_DRAIN_VERIFY",
];
const originalEnv = Object.fromEntries(
  keys.map((key) => [key, process.env[key]])
);
let pushes;
let entries;

beforeEach(() => {
  process.env.VERCEL_ENV = "development";
  process.env.REACT_APP_SENTRY_DSN = "";
  process.env.VERCEL_DRAIN_SECRET = "made-up-drain-secret";
  process.env.GRAFANA_LOKI_URL = "https://loki.example.invalid";
  process.env.GRAFANA_LOKI_USER = "123";
  process.env.GRAFANA_LOKI_TOKEN = "made-up-write-token";
  process.env.VERCEL_LOG_DRAIN_PROJECT_ID = "prj_test";
  process.env.VERCEL_LOG_DRAIN_VERIFY = "made-up-verification";
  pushes = [];
  entries = [];
  initServerLogger({ providers: [{ log: (entry) => entries.push(entry) }] });
  mock.method(globalThis, "fetch", async (url, init) => {
    pushes.push({ url: String(url), init });
    return new Response(undefined, { status: 204 });
  });
});
afterEach(() => mock.restoreAll());
after(() => {
  resetServerLogger();
  for (const key of keys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

const event = (path) => ({
  projectId: "prj_test",
  environment: "production",
  timestamp: 1795600000000,
  source: "lambda",
  level: "error",
  path,
  proxy: { statusCode: 503 },
  message: "made-up-error",
});
const call = async (method, secret, body) => {
  const req = Readable.from([Buffer.from(body)]);
  req.method = method;
  req.headers = { "x-vercel-drain-secret": secret };
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end() {},
  };
  await handler(req, res);
  return res;
};

test("verifies the endpoint on GET without sending logs", async () => {
  const res = await call("GET", "", "");
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["x-vercel-verify"], "made-up-verification");
  assert.equal(pushes.length, 0);
});
test("rejects missing and incorrect authentication before parsing", async () => {
  for (const secret of ["", "wrong", "made-up-drain-secreX"]) {
    assert.equal((await call("POST", secret, "invalid")).statusCode, 403);
  }
  assert.equal(pushes.length, 0);
});
test("preserves status fields and labels for Explorer-style queries", async () => {
  const res = await call(
    "POST",
    process.env.VERCEL_DRAIN_SECRET,
    JSON.stringify(event("/api/health"))
  );
  assert.equal(res.statusCode, 204);
  const stream = JSON.parse(pushes[0].init.body).streams[0];
  assert.deepEqual(stream.stream, {
    service: "playground",
    env: "prd",
    source: "lambda",
    level: "error",
  });
  assert.equal(stream.values[0][0], "1795600000000000000");
  assert.equal(JSON.parse(stream.values[0][1]).proxy.statusCode, 503);
});
test("drops receiver traffic, other projects, and preview logs", async () => {
  const other = event("/api/health");
  other.projectId = "another-project";
  const preview = event("/api/health");
  preview.environment = "preview";
  const body = [event("/api/log-drain?test=1"), other, preview]
    .map(JSON.stringify)
    .join("\n");
  assert.equal(
    (await call("POST", process.env.VERCEL_DRAIN_SECRET, body)).statusCode,
    204
  );
  assert.equal(pushes.length, 0);
});
test("bounds source and level labels", async () => {
  const row = event("/");
  row.source = "unbounded-value";
  row.level = "unbounded-value";
  await call("POST", process.env.VERCEL_DRAIN_SECRET, JSON.stringify(row));
  assert.equal(
    JSON.parse(pushes[0].init.body).streams[0].stream.source,
    "unknown"
  );
  assert.equal(JSON.parse(pushes[0].init.body).streams[0].stream.level, "info");
});
test("rejects malformed batches without partially delivering them", async () => {
  for (const body of [
    "null",
    "[]",
    "invalid",
    JSON.stringify(event("/")) + "\ninvalid",
  ]) {
    assert.equal(
      (await call("POST", process.env.VERCEL_DRAIN_SECRET, body)).statusCode,
      400
    );
  }
  assert.equal(pushes.length, 0);
});
test("rejects oversized payloads", async () => {
  assert.equal(
    (
      await call(
        "POST",
        process.env.VERCEL_DRAIN_SECRET,
        "x".repeat(4 * 1024 * 1024 + 1)
      )
    ).statusCode,
    413
  );
  assert.equal(pushes.length, 0);
});
test("keeps upstream failures retryable and redacts secrets", async () => {
  for (const shouldThrow of [false, true]) {
    mock.method(globalThis, "fetch", async () => {
      if (shouldThrow) throw new Error(process.env.GRAFANA_LOKI_TOKEN);
      return new Response("private upstream body", { status: 503 });
    });
    assert.equal(
      (
        await call(
          "POST",
          process.env.VERCEL_DRAIN_SECRET,
          JSON.stringify(event("/"))
        )
      ).statusCode,
      502
    );
  }
  assert.ok(
    entries.every(
      (entry) => !entry.error?.message.includes("made-up-write-token")
    )
  );
});
test("fails closed when configuration is missing", async () => {
  delete process.env.GRAFANA_LOKI_TOKEN;
  assert.equal(
    (await call("POST", process.env.VERCEL_DRAIN_SECRET, "")).statusCode,
    503
  );
  assert.equal(pushes.length, 0);
});

test("accepts Vercel pre-parsed bodies without reading an exhausted stream", async () => {
  for (const body of [event("/"), [event("/")], JSON.stringify(event("/"))]) {
    const req = Readable.from([]);
    req.method = "POST";
    req.headers = { "x-vercel-drain-secret": process.env.VERCEL_DRAIN_SECRET };
    req.body = body;
    const res = { statusCode: 0, setHeader() {}, end() {} };
    await handler(req, res);
    assert.equal(res.statusCode, 204);
  }
  assert.equal(pushes.length, 3);
});

test("rejects invalid timestamps before contacting Loki", async () => {
  for (const timestamp of ["invalid", -1, 1.5]) {
    const row = event("/");
    row.timestamp = timestamp;
    assert.equal(
      (await call("POST", process.env.VERCEL_DRAIN_SECRET, JSON.stringify(row)))
        .statusCode,
      400
    );
  }
  assert.equal(pushes.length, 0);
});

test("drops receiver requests identified by the proxy path", async () => {
  const row = event("/function");
  row.proxy.path = "/api/log-drain";
  assert.equal(
    (await call("POST", process.env.VERCEL_DRAIN_SECRET, JSON.stringify(row)))
      .statusCode,
    204
  );
  assert.equal(pushes.length, 0);
});

// @vercel/node's addHelpers for a Content-Type it does not parse: readBody ends the stream, restoreBody replays it.
const callAfterVercelHelpers = async (body) => {
  const req = Readable.from([Buffer.from(body)]);
  await req.toArray();
  const replay = new PassThrough();
  const on = replay.on.bind(replay);
  const originalOn = req.on.bind(req);
  req.read = replay.read.bind(replay);
  req.on = req.addListener = (name, cb) =>
    name === "data" || name === "end" ? on(name, cb) : originalOn(name, cb);
  replay.end(Buffer.from(body));
  assert.ok(req.destroyed, "fixture must match the request the helper leaves");
  req.method = "POST";
  req.headers = {
    "content-type": "application/x-ndjson",
    "x-vercel-drain-secret": process.env.VERCEL_DRAIN_SECRET,
  };
  const res = { statusCode: 0, setHeader() {}, end() {} };
  await handler(req, res);
  return res;
};

test("reads an NDJSON batch that Vercel's helpers already consumed", async () => {
  const body = [event("/a"), event("/b")].map(JSON.stringify).join("\n");
  assert.equal((await callAfterVercelHelpers(body)).statusCode, 204);
  assert.equal(pushes.length, 1);
  assert.equal(JSON.parse(pushes[0].init.body).streams[0].values.length, 2);
});

test("rejects a malformed NDJSON batch that Vercel's helpers already consumed", async () => {
  assert.equal((await callAfterVercelHelpers("not json\n")).statusCode, 400);
  assert.equal(pushes.length, 0);
});
