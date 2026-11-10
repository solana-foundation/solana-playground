import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const GATE = fileURLToPath(new URL("./server-url-gate.mjs", import.meta.url));

/** Runs the gate as `build:bundle` does, with only the given variables; Node drops an `undefined` one */
const runGate = ({ VERCEL_ENV, REACT_APP_SERVER_URL }) =>
  spawnSync(process.execPath, [GATE], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, VERCEL_ENV, REACT_APP_SERVER_URL },
  });

test("client-v2-build-server-endpoint: A preview build without the variable", () => {
  const result = runGate({ VERCEL_ENV: "preview" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /REACT_APP_SERVER_URL/);
});

test("client-v2-build-server-endpoint: A CI build", () => {
  assert.equal(runGate({}).status, 0);
});

test("passes a deployment build that has the variable", () => {
  const result = runGate({
    VERCEL_ENV: "production",
    REACT_APP_SERVER_URL: "https://server.example",
  });

  assert.equal(result.status, 0);
});
