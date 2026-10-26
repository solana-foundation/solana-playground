import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";

import { getAuth, isAllowedOrigin, readSession } from "./auth.mjs";

const SIGN_IN = {
  DATABASE_URL: "postgres://u:p@127.0.0.1:1/none",
  GITHUB_CLIENT_ID: "id",
  GITHUB_CLIENT_SECRET: "secret",
  AUTH_SECRET: "a-test-secret-of-at-least-32-bytes!",
};

/** Sets each named variable, or deletes it for `undefined`, and returns a restore */
const withEnv = (vars) => {
  const saved = Object.keys(vars).map((name) => [name, process.env[name]]);
  const assign = (entries) => {
    for (const [name, value] of entries) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  assign(Object.entries(vars));
  return () => assign(saved);
};

const req = (headers = {}) => ({ headers });

describe("readSession", () => {
  let restore;
  beforeEach(() => {
    restore = withEnv(SIGN_IN);
  });
  afterEach(() => {
    mock.restoreAll();
    restore();
  });

  test("answers unconfigured when a sign-in variable is missing", async () => {
    restore();
    restore = withEnv({ AUTH_SECRET: undefined });
    assert.deepEqual(await readSession(req()), { status: "unconfigured" });
  });

  for (const [label, getSession, expected] of [
    [
      "answers signed-in with the user's id",
      async () => ({ user: { id: 7 } }),
      { status: "signed-in", user: { id: "7" } },
    ],
    [
      "answers signed-out when there is no session",
      async () => null,
      { status: "signed-out" },
    ],
    [
      "answers unavailable when the lookup throws",
      async () => {
        throw new Error("database down");
      },
      { status: "unavailable" },
    ],
  ]) {
    test(label, async () => {
      mock.method((await getAuth()).api, "getSession", getSession);
      mock.method(console, "error", () => {});
      assert.deepEqual(await readSession(req()), expected);
    });
  }
});

describe("isAllowedOrigin", () => {
  let restore;
  beforeEach(() => {
    restore = withEnv({ AUTH_BASE_URL: "https://app.test/base" });
  });
  afterEach(() => restore());

  for (const [label, origin, expected] of [
    [
      "allows our origin when the base URL carries a path",
      "https://app.test",
      true,
    ],
    // A sandboxed frame or a `file:` page sends the literal string "null"
    ["refuses an opaque origin", "null", false],
  ]) {
    test(label, () => {
      assert.equal(isAllowedOrigin(req({ origin })), expected);
    });
  }
});
