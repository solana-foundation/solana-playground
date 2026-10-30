import assert from "node:assert/strict";
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  it,
  mock,
} from "node:test";
import pg from "pg";

import { learnAccountAge } from "./account-age.mjs";

// `yarn test-api` loads `.env`; without a database this suite skips rather
// than fails, which is what lets the unit suites run on their own.
const DB = process.env.DATABASE_URL;

// A pool of the test's own: the route's comes from `persistence`, which a
// feature may not import. The lookup takes any `query` of that shape.
const pool = DB && new pg.Pool({ connectionString: DB });
const query = (text, params) => pool.query(text, params);
after(() => pool && pool.end());

describe("learnAccountAge", { skip: !DB && "DATABASE_URL not set" }, () => {
  const USER = "test-user-account-age";

  before(async () => {
    await query(
      `insert into "user" (id, name, email, "emailVerified")
       values ($1, 'Test', 'account-age@example.com', false)
       on conflict (id) do nothing`,
      [USER]
    );
    await query(
      `insert into account (id, "accountId", "providerId", "userId", "accessToken", "updatedAt")
       values ('test-account-age', '42', 'github', $1, 'gho_token', now())
       on conflict (id) do nothing`,
      [USER]
    );
  });

  beforeEach(async () => {
    await query(`update "user" set "githubCreatedAt" = null where id = $1`, [
      USER,
    ]);
    mock.method(console, "warn", () => {});
  });

  afterEach(() => mock.restoreAll());

  const stored = async () => {
    const { rows } = await query(
      `select "githubCreatedAt" from "user" where id = $1`,
      [USER]
    );
    return rows[0].githubCreatedAt;
  };

  const github = (answer) => mock.method(global, "fetch", answer);

  it("stores the creation date GitHub reports, read with the user's token", async () => {
    const fetched = github(async () =>
      Response.json({ login: "ada", created_at: "2011-01-25T18:44:36Z" })
    );

    const result = await learnAccountAge(query, USER);

    assert.equal(result.outcome, "stored");
    assert.deepEqual(await stored(), new Date("2011-01-25T18:44:36Z"));
    const [url, init] = fetched.mock.calls[0].arguments;
    assert.equal(url, "https://api.github.com/user");
    assert.equal(init.headers.authorization, "Bearer gho_token");
  });

  it("stores nothing when GitHub refuses the read", async () => {
    github(async () => new Response("Bad credentials", { status: 401 }));

    assert.deepEqual(await learnAccountAge(query, USER), {
      outcome: "skipped",
      reason: "refused",
    });
    assert.equal(await stored(), null);
  });

  it("stores nothing when GitHub does not answer in time", async () => {
    github(
      (_, init) =>
        new Promise((_, reject) =>
          init.signal.addEventListener("abort", () =>
            reject(init.signal.reason)
          )
        )
    );

    assert.deepEqual(await learnAccountAge(query, USER, { timeoutMs: 20 }), {
      outcome: "skipped",
      reason: "unreachable",
    });
    assert.equal(await stored(), null);
  });

  it("stores nothing for a date GitHub sends malformed", async () => {
    github(async () => Response.json({ created_at: "soon" }));

    assert.equal((await learnAccountAge(query, USER)).reason, "malformed");
    assert.equal(await stored(), null);
  });

  it("logs why a body that is not JSON was skipped, without the body", async (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    github(async () => new Response('{"email": "private@example.com"'));

    assert.equal((await learnAccountAge(query, USER)).reason, "malformed");
    assert.deepEqual(warn.mock.calls[0].arguments[1], {
      userId: USER,
      reason: "malformed",
      detail: "SyntaxError",
    });
  });

  it("asks GitHub nothing for a user with no GitHub token", async () => {
    const fetched = github(async () => Response.json({}));

    const result = await learnAccountAge(query, "test-user-account-age-none");

    assert.equal(result.reason, "no-token");
    assert.equal(fetched.mock.callCount(), 0);
  });

  it("never throws when the database fails", async () => {
    mock.method(console, "error", () => {});
    const failing = async () => {
      throw new Error("connection refused");
    };

    assert.deepEqual(await learnAccountAge(failing, USER), {
      outcome: "skipped",
      reason: "database",
    });
  });
});
