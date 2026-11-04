import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("./check-unstable-env.mjs", import.meta.url)
);

/** Exit code of the check under exactly `env`, nothing inherited */
const exitCode = (env) =>
  spawnSync(process.execPath, [script], { env, encoding: "utf8" }).status;

for (const [label, env, expected] of [
  [
    "fails the flag the client turns on",
    { REACT_APP_SERVER_UNSTABLE: "true" },
    1,
  ],
  ["passes an unset flag", {}, 0],
  ["passes a value the client ignores", { REACT_APP_SERVER_UNSTABLE: "1" }, 0],
]) {
  test(label, () => assert.equal(exitCode(env), expected));
}
