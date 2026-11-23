import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteExpiredSessions } from "../src/features/auth/server.mjs";
import { deleteExpiredAudit } from "../src/features/build-server/server.mjs";
import {
  clearDeletedProjectNames,
  query,
} from "../src/features/persistence/server.mjs";
import { handleWith } from "./retention.mjs";

// `yarn test-api` loads `.env`; the database-backed cases skip without one.
const DB = process.env.DATABASE_URL;

const SECRET = "a-made-up-cron-secret";
const USER = "test-user-retention";

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

const load = async () => {
  const url = new URL("./retention.mjs", import.meta.url);
  url.searchParams.set("t", String(Math.random()));
  return import(url.href);
};

const call = async (handler, { method = "GET", authorization } = {}) => {
  const res = makeRes();
  await handler(
    { method, headers: authorization ? { authorization } : {} },
    res
  );
  return res;
};

describe("/api/retention", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
  });

  it("answers 405 with Allow: GET for another method", async () => {
    const { default: handler } = await load();
    const res = await call(handler, {
      method: "POST",
      authorization: `Bearer ${SECRET}`,
    });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "GET");
  });

  it("answers 503 and runs nothing while CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    let ran = 0;
    const step = async () => ++ran;
    const handler = handleWith({
      steps: { sessions: step, buildAudit: step, projectNames: step },
    });
    const res = await call(handler, { authorization: `Bearer ${SECRET}` });
    assert.equal(res.statusCode, 503);
    assert.equal(ran, 0);
  });

  for (const [title, authorization] of [
    ["no Authorization header", undefined],
    [
      "a wrong secret of the same length",
      `Bearer ${"x".repeat(SECRET.length)}`,
    ],
    ["a wrong secret of another length", "Bearer short"],
    ["the secret without the scheme", SECRET],
  ]) {
    it(`answers 401 and runs nothing for ${title}`, async () => {
      let ran = 0;
      const step = async () => ++ran;
      const handler = handleWith({
        steps: { sessions: step, buildAudit: step, projectNames: step },
      });
      const res = await call(handler, { authorization });
      assert.equal(res.statusCode, 401);
      assert.equal(ran, 0);
    });
  }

  it("answers the counts and keeps going when one step fails", async () => {
    const handler = handleWith({
      steps: {
        sessions: async () => 2,
        buildAudit: async () => {
          throw new Error("build_audit is gone");
        },
        projectNames: async () => 3,
      },
    });
    const res = await call(handler, { authorization: `Bearer ${SECRET}` });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(JSON.parse(res.body), { sessions: 2, projectNames: 3 });
  });

  describe("against Postgres", { skip: !DB && "DATABASE_URL not set" }, () => {
    const days = (n) => `now() - interval '${n} days'`;

    before(async () => {
      await query(
        `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         values ($1, 'Test', 'retention@example.com', false, now(), now())
         on conflict (id) do nothing`,
        [USER]
      );
    });

    after(async () => {
      await query(`delete from "user" where id = $1`, [USER]);
      await query(`delete from build_audit where user_id = $1`, [USER]);
    });

    beforeEach(async () => {
      await query(`delete from session where "userId" = $1`, [USER]);
      await query(`delete from build_audit where user_id = $1`, [USER]);
      await query(`delete from projects where user_id = $1`, [USER]);
    });

    const run = async () => {
      const { default: handler } = await load();
      return call(handler, { authorization: `Bearer ${SECRET}` });
    };

    const session = (id, expires) =>
      query(
        `insert into session (id, "expiresAt", token, "updatedAt", "userId")
         values ($1, ${expires}, $1, now(), $2)`,
        [id, USER]
      );

    const audit = (project, age) =>
      query(
        `insert into build_audit (user_id, at, project_id, unstable, request_bytes)
         values ($1, ${age}, $2, false, 1)`,
        [USER, project]
      );

    it("deletes an expired session and keeps a live one", async () => {
      await session("ret-expired", `now() - interval '1 day'`);
      await session("ret-live", `now() + interval '1 day'`);

      const res = await run();

      assert.equal(res.statusCode, 200);
      assert.ok(JSON.parse(res.body).sessions >= 1);
      const { rows } = await query(
        `select id from session where "userId" = $1`,
        [USER]
      );
      assert.deepEqual(
        rows.map((r) => r.id),
        ["ret-live"]
      );
    });

    it("deletes build_audit rows past 90 days and keeps newer ones", async () => {
      await audit("old", days(91));
      await audit("new", days(89));

      const res = await run();

      assert.equal(res.statusCode, 200);
      assert.ok(JSON.parse(res.body).buildAudit >= 1);
      const { rows } = await query(
        `select project_id from build_audit where user_id = $1`,
        [USER]
      );
      assert.deepEqual(
        rows.map((r) => r.project_id),
        ["new"]
      );
    });

    it("clears the name of a project deleted before, and keeps the row", async () => {
      await query(
        `insert into projects (id, user_id, name, kind, deleted_at)
         values ('old', $1, 'alice-defi', 'project', now()),
                ('live', $1, 'bob-live', 'project', null)`,
        [USER]
      );

      const res = await run();

      assert.equal(res.statusCode, 200);
      assert.ok(JSON.parse(res.body).projectNames >= 1);
      const { rows } = await query(
        `select id, name, deleted_at is not null as deleted
           from projects where user_id = $1 order by id`,
        [USER]
      );
      assert.deepEqual(rows, [
        { id: "live", name: "bob-live", deleted: false },
        { id: "old", name: "", deleted: true },
      ]);
    });

    it("clears the names and sessions when the build_audit step fails", async () => {
      await session("ret-expired", `now() - interval '1 day'`);
      await query(
        `insert into projects (id, user_id, name, kind, deleted_at)
         values ('old', $1, 'alice-defi', 'project', now())`,
        [USER]
      );
      const handler = handleWith({
        steps: {
          sessions: () => deleteExpiredSessions(query),
          buildAudit: () =>
            deleteExpiredAudit(async () => {
              throw new Error("build_audit delete failed");
            }),
          projectNames: clearDeletedProjectNames,
        },
      });

      const res = await call(handler, { authorization: `Bearer ${SECRET}` });

      assert.equal(res.statusCode, 500);
      const body = JSON.parse(res.body);
      assert.ok(body.sessions >= 1);
      assert.ok(body.projectNames >= 1);
      assert.equal("buildAudit" in body, false);
      const { rows } = await query(
        `select count(*)::int as n from session where "userId" = $1`,
        [USER]
      );
      assert.equal(rows[0].n, 0);
    });
  });
});
