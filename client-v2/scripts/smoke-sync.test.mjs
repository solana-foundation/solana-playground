import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { smoke } from "./smoke-sync.mjs";

const answer = (status, body) => async () =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  });
const run = (fetchImpl, { attempts = 1, bypassSecret } = {}) =>
  smoke("https://x.vercel.app", {
    fetchImpl,
    attempts,
    delayMs: 0,
    bypassSecret,
  });

test("passes on enabled and db ok", async () => {
  const r = await run(answer(200, { enabled: true, db: "ok" }));
  assert.equal(r.ok, true);
});

test("fails with the body when sync is off", async () => {
  const r = await run(answer(200, { enabled: false, db: "ok" }));
  assert.equal(r.ok, false);
  assert.equal(r.body, '{"enabled":false,"db":"ok"}');
});

test("fails on an unreachable database", async () => {
  const r = await run(answer(200, { enabled: false, db: "unreachable" }));
  assert.equal(r.ok, false);
});

test("fails on an unconfigured database", async () => {
  const r = await run(answer(200, { enabled: false, db: "unconfigured" }));
  assert.equal(r.ok, false);
});

test("fails on a protection redirect and names the secret", async () => {
  const r = await run(answer(302, ""));
  assert.equal(r.ok, false);
  assert.match(r.reason, /SMOKE_BYPASS_SECRET/);
});

test("fails on a non-JSON body", async () => {
  const r = await run(answer(200, "<html>login</html>"));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "body is not JSON");
});

test("fails when nothing answers", async () => {
  const r = await run(async () => {
    throw new Error("ECONNREFUSED");
  });
  assert.equal(r.ok, false);
  assert.equal(r.body, "ECONNREFUSED");
});

test("sends the bypass header only when given a secret", async () => {
  let seen;
  const spy = async (_url, init) => {
    seen = init.headers;
    return new Response('{"enabled":true,"db":"ok"}');
  };
  await run(spy);
  assert.equal(seen["x-vercel-protection-bypass"], undefined);
  await run(spy, { bypassSecret: "s3" });
  assert.equal(seen["x-vercel-protection-bypass"], "s3");
});

test("retries and passes when a later attempt answers", async () => {
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    return calls < 2
      ? new Response("down", { status: 503 })
      : new Response('{"enabled":true,"db":"ok"}');
  };
  const r = await run(flaky, { attempts: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
});

test("fails when enabled but the database is not ok", async () => {
  const r = await run(answer(200, { enabled: true, db: "unreachable" }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /expected/);
});

test("fails on 401 with the protection hint, and on 503 without it", async () => {
  assert.match((await run(answer(401, "{}"))).reason, /SMOKE_BYPASS_SECRET/);
  const r = await run(answer(503, "down"));
  assert.equal(r.reason, "status 503");
});

test("reports the last result when every attempt fails", async () => {
  let calls = 0;
  const bodies = [
    new Response("a", { status: 503 }),
    new Response("b", { status: 503 }),
    new Response('{"enabled":false,"db":"unreachable"}'),
  ];
  const r = await run(async () => bodies[calls++], { attempts: 3 });
  assert.equal(calls, 3);
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 3);
  assert.equal(r.body, '{"enabled":false,"db":"unreachable"}');
});

test("never follows a redirect and bounds the request", async () => {
  let seen;
  await run(async (_url, init) => {
    seen = init;
    return new Response('{"enabled":true,"db":"ok"}');
  });
  assert.equal(seen.redirect, "manual");
  assert.ok(seen.signal instanceof AbortSignal);
});

test("cuts a long body", async () => {
  const r = await run(answer(500, "x".repeat(2000)));
  assert.equal(r.body.length, 503);
  assert.ok(r.body.endsWith("..."));
});

// The workflow step reads only the exit code, so the entrypoint is run for
// real: a guard that stopped matching would exit 0 without probing.
const script = fileURLToPath(new URL("./smoke-sync.mjs", import.meta.url));
// The parent's environment with the retry delay removed, so a red case does not wait.
const childEnv = () => {
  const env = Object.assign({}, process.env);
  env.SMOKE_RETRY_DELAY_MS = "0";
  return env;
};
const runWithoutUrl = () =>
  spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: childEnv(),
  });
const serve = (body) =>
  new Promise((resolve) => {
    const server = createServer((_req, res) => res.end(JSON.stringify(body)));
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` })
    );
  });
const runAgainst = async (body) => {
  const { server, url } = await serve(body);
  try {
    // spawnSync would block the server's event loop, so use the async form.
    const child = spawn(process.execPath, [script, url], {
      env: childEnv(),
    });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    const code = await new Promise((resolve) => child.on("close", resolve));
    return { code, err, url };
  } finally {
    server.close();
  }
};

test("exits 2 with usage when no URL is given", () => {
  const r = runWithoutUrl();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});

test("exits 0 against a healthy deployment", async () => {
  const r = await runAgainst({ enabled: true, db: "ok" });
  assert.equal(r.code, 0);
});

test("exits 1 and names the URL and the body when sync is off", async () => {
  const r = await runAgainst({ enabled: false, db: "ok" });
  assert.equal(r.code, 1);
  assert.ok(r.err.includes(r.url));
  assert.ok(r.err.includes('{"enabled":false,"db":"ok"}'));
});
