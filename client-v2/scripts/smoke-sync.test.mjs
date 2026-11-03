import assert from "node:assert/strict";
import { test } from "node:test";

import { smoke } from "./smoke-sync.mjs";

const answer = (status, body) => async () =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  });
const run = (fetchImpl, extra = {}) =>
  smoke("https://x.vercel.app", {
    fetchImpl,
    attempts: 1,
    delayMs: 0,
    ...extra,
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
