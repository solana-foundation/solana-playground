import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { parseAdditionalUserInputFromProviderProfile } from "better-auth/db";

import {
  getAuth,
  isAllowedOrigin,
  mapGithubProfile,
  missingConfig,
  readSession,
} from "./auth.mjs";

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
    // eslint-disable-next-line jest/valid-title -- a table test, titled by its row
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
    // eslint-disable-next-line jest/valid-title -- a table test, titled by its row
    test(label, () => {
      assert.equal(isAllowedOrigin(req({ origin })), expected);
    });
  }
});

describe("GitHub profile fields", () => {
  let restore;
  beforeEach(() => {
    restore = withEnv(SIGN_IN);
  });
  afterEach(() => restore());

  const PROFILE = {
    login: "ada",
    created_at: "2011-01-25T18:44:36Z",
  };

  test("maps the login and the account's creation date", () => {
    assert.deepEqual(mapGithubProfile(PROFILE), {
      login: "ada",
      githubCreatedAt: new Date("2011-01-25T18:44:36Z"),
    });
  });

  test("leaves out a creation date GitHub sends malformed", () => {
    assert.equal(
      mapGithubProfile({ login: "ada", created_at: "soon" }).githubCreatedAt,
      undefined
    );
    assert.equal(mapGithubProfile({ login: "ada" }).githubCreatedAt, undefined);
  });

  // Better Auth runs the mapped profile through this before creating the user,
  // and drops every field declared `input: false`: `login` was never stored
  test("survives Better Auth's parsing into the created user", async () => {
    const created = parseAdditionalUserInputFromProviderProfile(
      (await getAuth()).options,
      mapGithubProfile(PROFILE),
      "create"
    );
    assert.equal(created.login, "ada");
    assert.deepEqual(created.githubCreatedAt, new Date("2011-01-25T18:44:36Z"));
  });

  // `input: true` above is safe only while no endpoint lets a user write their
  // own fields: `githubCreatedAt` decides their spend on `/api/agent`
  test("answers 404 to update-user, so a user cannot set their own fields", async () => {
    const res = await (
      await getAuth()
    ).handler(
      new Request("http://localhost:3000/api/auth/update-user", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ githubCreatedAt: "2000-01-01T00:00:00Z" }),
      })
    );
    assert.equal(res.status, 404);
  });
});

describe("missingConfig", () => {
  /** Sign-in's own variables, with the database left to each case */
  const GITHUB = {
    GITHUB_CLIENT_ID: "id",
    GITHUB_CLIENT_SECRET: "secret",
    AUTH_SECRET: "a-test-secret-of-at-least-32-bytes!",
  };

  /** A complete `cloud-sql` production, without DATABASE_URL */
  const CLOUD_SQL = {
    DB_PROVIDER: "cloud-sql",
    DATABASE_URL: undefined,
    CLOUD_SQL_INSTANCE: "project:region:solpg",
    CLOUD_SQL_DATABASE: "solpg",
    CLOUD_SQL_USER: "vercel-production@project.iam",
    GCP_PROJECT_NUMBER: "123",
    GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
    GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel",
    GCP_SERVICE_ACCOUNT_EMAIL:
      "vercel-production@project.iam.gserviceaccount.com",
  };

  const restores = [];
  /** Applies `vars` for the current case, undone after it */
  const set = (vars) => restores.push(withEnv(vars));
  beforeEach(() => set(GITHUB));
  afterEach(() => {
    while (restores.length) restores.pop()();
  });

  test("names a missing Cloud SQL variable, and not DATABASE_URL", () => {
    set(CLOUD_SQL);
    set({ CLOUD_SQL_USER: undefined });
    assert.deepEqual(missingConfig(), ["CLOUD_SQL_USER"]);
  });

  test("names no database variable for a complete Cloud SQL deployment", () => {
    set(CLOUD_SQL);
    assert.deepEqual(missingConfig(), []);
  });

  test("names DB_PROVIDER when it names no provider", () => {
    // A stray DATABASE_URL beside it must not make sign-in look configured
    set({ DB_PROVIDER: "cloudsql", DATABASE_URL: "postgres://x/y" });
    assert.deepEqual(missingConfig(), ["DB_PROVIDER"]);
  });
});
