import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";

import {
  isAllowedOrigin,
  revokeGithubGrantWith,
} from "../src/features/auth/server.mjs";
import { query, transaction } from "../src/features/persistence/server.mjs";
import { handleWith } from "./account.mjs";

// `yarn test-api` loads `.env`; the database-backed cases skip without one.
const DB = process.env.DATABASE_URL;

const USER = "test-user-account-a";
const OTHER = "test-user-account-b";

/** Minimal stand-in for the platform's response object */
const makeRes = () => ({
  statusCode: 0,
  headers: {},
  body: "",
  setHeader(k, v) {
    this.headers[k.toLowerCase()] = v;
  },
  end(b) {
    this.body = b ?? "";
  },
});

const grant = (status) =>
  // eslint-disable-next-line unicorn/no-null -- a 204 has a null body by definition
  mock.fn(async () => new Response(null, { status }));

/** The route's dependencies for a signed-in user; a case overrides what it is about */
const depsWith = (over) => ({
  missingConfig: over.missingConfig ?? (() => []),
  isAllowedOrigin: over.isAllowedOrigin ?? (() => true),
  readSession:
    over.readSession ??
    (async () => ({ status: "signed-in", user: { id: USER } })),
  readGithubToken: over.readGithubToken ?? (async () => "gho_made-up-token"),
  revokeGithubGrant:
    over.revokeGithubGrant ?? revokeGithubGrantWith(grant(204)),
  sessionCookieExpiry: over.sessionCookieExpiry ?? (async () => []),
  transaction: over.transaction ?? transaction,
});

const call = async (deps, { method = "DELETE", headers = {} } = {}) => {
  const res = makeRes();
  await handleWith(deps)({ method, headers }, res);
  return res;
};

describe("DELETE /api/account", () => {
  beforeEach(() => {
    process.env.GITHUB_CLIENT_ID = "made-up-client-id";
    process.env.GITHUB_CLIENT_SECRET = "made-up-client-secret";
  });

  it("answers 405 with Allow: DELETE for another method", async () => {
    const res = await call(depsWith({}), { method: "GET" });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "DELETE");
  });

  it("answers 503 when sign-in is not configured", async () => {
    const res = await call(depsWith({ missingConfig: () => ["AUTH_SECRET"] }));
    assert.equal(res.statusCode, 503);
  });

  it("answers 403 and deletes nothing for a cross-site request", async () => {
    process.env.AUTH_BASE_URL = "https://solpg.example";
    try {
      const transact = mock.fn(transaction);
      const res = await call(
        depsWith({ isAllowedOrigin, transaction: transact }),
        { headers: { origin: "https://evil.example" } }
      );
      assert.equal(res.statusCode, 403);
      assert.equal(transact.mock.callCount(), 0);
    } finally {
      delete process.env.AUTH_BASE_URL;
    }
  });

  it("answers 401 and deletes nothing without a session", async () => {
    const transact = mock.fn(transaction);
    const res = await call(
      depsWith({
        readSession: async () => ({ status: "signed-out" }),
        transaction: transact,
      })
    );
    assert.equal(res.statusCode, 401);
    assert.equal(transact.mock.callCount(), 0);
  });

  for (const status of ["unavailable", "unconfigured"]) {
    it(`answers 503 and deletes nothing when the session read is ${status}`, async () => {
      const transact = mock.fn(transaction);
      const res = await call(
        depsWith({
          readSession: async () => ({ status }),
          transaction: transact,
        })
      );
      assert.equal(res.statusCode, 503);
      assert.equal(transact.mock.callCount(), 0);
    });
  }

  describe("against Postgres", { skip: !DB && "DATABASE_URL not set" }, () => {
    const seed = async (id, login) => {
      await query(
        `insert into "user" (id, name, email, "emailVerified", login, "createdAt", "updatedAt")
         values ($1, 'Test', $1 || '@example.com', false, $2, now(), now())`,
        [id, login]
      );
      // No token: the token backfill's test counts every plaintext one in this database
      await query(
        `insert into account (id, "accountId", "providerId", "userId", "createdAt", "updatedAt")
         values ($1 || '-acc', '4242', 'github', $1, now(), now())`,
        [id]
      );
      await query(
        `insert into session (id, "expiresAt", token, "updatedAt", "userId")
         values ($1 || '-s', now() + interval '1 day', $1 || '-t', now(), $1)`,
        [id]
      );
      await query(
        `insert into projects (id, user_id, name, kind) values ('p1', $1, 'proj', 'project')`,
        [id]
      );
      await query(
        `insert into project_files (user_id, project_id, path, content) values ($1, 'p1', 'a.rs', 'x')`,
        [id]
      );
      const { rows } = await query(
        `insert into conversations (id, user_id, project_id)
         values (gen_random_uuid(), $1, 'p1') returning id`,
        [id]
      );
      await query(
        `insert into messages (id, conversation_id, kind, payload, created_at)
         values (gen_random_uuid(), $1, 'user', '{}', now())`,
        [rows[0].id]
      );
      await query(
        `insert into agent_spend (user_id, day, spent) values ($1, current_date, 5)`,
        [id]
      );
      await query(
        // A started turn is the one outcome that has not settled yet
        `insert into agent_turn (user_id, day, tier, outcome, settled_at)
         values ($1, current_date, 'newcomer', 'started', null)`,
        [id]
      );
      await query(
        `insert into build_audit (user_id, login, github_id, project_id, unstable, request_bytes)
         values ($1, $2, '4242', 'p1', false, 10)`,
        [id, login]
      );
    };

    /**
     * Tables that keep a user's id on purpose: `build_audit` outlives the
     * account without its identity, and dbmate's own table holds no user
     */
    const KEPT = ["build_audit", "schema_migrations"];

    /**
     * Every table with a column naming a user (`user_id`, Better Auth's
     * `userId`), read from the schema so a table added later is checked too,
     * `"user"` itself first
     */
    const userTables = async () => {
      const { rows } = await query(
        `select table_name as table, column_name as column
           from information_schema.columns
          where table_schema = current_schema()
            and column_name in ('user_id', 'userId')
            and table_name <> all($1)
          order by table_name`,
        [KEPT]
      );
      return [{ table: "user", column: "id" }].concat(rows);
    };

    /** The tables a delete from `"user"` empties through `on delete cascade` */
    const cascadedFromUser = async () => {
      const { rows } = await query(
        `select conrelid::regclass::text as child,
                confrelid::regclass::text as parent
           from pg_constraint
          where contype = 'f' and confdeltype = 'c'`
      );
      const name = (regclass) => regclass.replaceAll('"', "");
      const reached = new Set(["user"]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const { child, parent } of rows) {
          if (reached.has(name(parent)) && !reached.has(name(child))) {
            reached.add(name(child));
            grew = true;
          }
        }
      }
      return reached;
    };

    it("finds every table keyed by a user cascaded from it", async () => {
      const tables = (await userTables()).map(({ table }) => table);
      const cascaded = await cascadedFromUser();

      // The schema read still sees the tables it was written against
      for (const known of ["account", "session", "projects", "agent_turn"]) {
        assert.ok(tables.includes(known), `${known} is not found`);
      }
      assert.deepEqual(
        tables.filter((table) => !cascaded.has(table)),
        [],
        "these tables hold a user's rows that the account deletion leaves"
      );
    });

    /** How many rows each table holds for the user, plus their messages */
    const counts = async (id) => {
      const out = {};
      for (const { table, column } of await userTables()) {
        const { rows } = await query(
          `select count(*)::int as n from "${table}" where "${column}" = $1`,
          [id]
        );
        out[table] = rows[0].n;
      }
      const { rows } = await query(
        `select count(*)::int as n from messages m
           join conversations c on c.id = m.conversation_id
          where c.user_id = $1`,
        [id]
      );
      out.messages = rows[0].n;
      return out;
    };

    const clean = async () => {
      for (const id of [USER, OTHER]) {
        await query(`delete from "user" where id = $1`, [id]);
        await query(`delete from build_audit where user_id = $1`, [id]);
      }
    };

    before(clean);
    after(clean);
    beforeEach(async () => {
      await clean();
      await seed(USER, "alice");
      await seed(OTHER, "bob");
    });

    it("removes every row of the user and none of another's", async () => {
      const others = await counts(OTHER);

      const res = await call(depsWith({}));

      assert.equal(res.statusCode, 200);
      assert.deepEqual(await counts(USER), {
        user: 0,
        account: 0,
        session: 0,
        projects: 0,
        project_files: 0,
        conversations: 0,
        agent_spend: 0,
        agent_turn: 0,
        messages: 0,
      });
      assert.deepEqual(await counts(OTHER), others);
      assert.equal(others.messages, 1);
    });

    it("keeps the build_audit rows without the identity", async () => {
      await call(depsWith({}));

      const { rows } = await query(
        `select user_id, login, github_id, project_id from build_audit
          where user_id = any($1) order by user_id`,
        [[USER, OTHER]]
      );
      assert.deepEqual(rows, [
        // eslint-disable-next-line unicorn/no-null -- Postgres rows read a cleared column as null
        { user_id: USER, login: null, github_id: null, project_id: "p1" },
        { user_id: OTHER, login: "bob", github_id: "4242", project_id: "p1" },
      ]);
    });

    it("changes nothing and reports when the transaction fails", async () => {
      const failing = (fn) =>
        transaction((q) =>
          fn(async (text, params) => {
            if (/delete from "user"/.test(text)) {
              throw new Error("the delete failed");
            }
            return q(text, params);
          })
        );
      const revoke = mock.fn(async () => true);

      const res = await call(
        depsWith({ transaction: failing, revokeGithubGrant: revoke })
      );

      assert.equal(res.statusCode, 500);
      assert.equal(revoke.mock.callCount(), 0);
      assert.equal((await counts(USER)).user, 1);
      const { rows } = await query(
        `select login, github_id from build_audit where user_id = $1`,
        [USER]
      );
      assert.deepEqual(rows, [{ login: "alice", github_id: "4242" }]);
    });

    it("answers githubRevoked: true when GitHub answers 204", async () => {
      const fetchImpl = grant(204);

      const res = await call(
        depsWith({ revokeGithubGrant: revokeGithubGrantWith(fetchImpl) })
      );

      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.body), { githubRevoked: true });
      const [url, init] = fetchImpl.mock.calls[0].arguments;
      assert.equal(
        url,
        "https://api.github.com/applications/made-up-client-id/grant"
      );
      assert.equal(init.method, "DELETE");
      assert.equal(
        init.headers.authorization,
        `Basic ${Buffer.from(
          "made-up-client-id:made-up-client-secret"
        ).toString("base64")}`
      );
      assert.deepEqual(JSON.parse(init.body), {
        access_token: "gho_made-up-token",
      });
    });

    it("deletes the account and answers githubRevoked: false when GitHub is unreachable", async () => {
      const fetchImpl = mock.fn(async () => {
        throw new Error("network down");
      });

      const res = await call(
        depsWith({ revokeGithubGrant: revokeGithubGrantWith(fetchImpl) })
      );

      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.body), { githubRevoked: false });
      assert.equal((await counts(USER)).user, 0);
    });

    it("answers githubRevoked: false when GitHub refuses", async () => {
      const res = await call(
        depsWith({ revokeGithubGrant: revokeGithubGrantWith(grant(422)) })
      );
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.body), { githubRevoked: false });
    });

    it("deletes the account and skips the revoke when the token read throws", async () => {
      const fetchImpl = grant(204);

      const res = await call(
        depsWith({
          readGithubToken: async () => {
            throw new Error("Better Auth is down");
          },
          revokeGithubGrant: revokeGithubGrantWith(fetchImpl),
        })
      );

      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.body), { githubRevoked: false });
      assert.equal((await counts(USER)).user, 0);
      // Reported once, by the read: the revoke has nothing to add
      assert.equal(fetchImpl.mock.callCount(), 0);
    });

    it("deletes the account and answers githubRevoked: false without a token", async () => {
      const fetchImpl = grant(204);

      const res = await call(
        depsWith({
          readGithubToken: async () => undefined,
          revokeGithubGrant: revokeGithubGrantWith(fetchImpl),
        })
      );

      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.body), { githubRevoked: false });
      assert.equal((await counts(USER)).user, 0);
      assert.equal(fetchImpl.mock.callCount(), 0);
    });

    it("answers 200 when a step after the commit throws", async () => {
      const res = await call(
        depsWith({
          revokeGithubGrant: async () => {
            throw new Error("revoke threw");
          },
          sessionCookieExpiry: async () => {
            throw new Error("cookie threw");
          },
        })
      );

      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.body), { githubRevoked: false });
      assert.equal((await counts(USER)).user, 0);
    });

    it("passes the session cookie's expiry on", async () => {
      const res = await call(
        depsWith({ sessionCookieExpiry: async () => ["session=; Max-Age=0"] })
      );
      assert.deepEqual(res.headers["set-cookie"], ["session=; Max-Age=0"]);
    });
  });
});
