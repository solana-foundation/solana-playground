import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, mock } from "node:test";

import {
  BUILD_MAX_DURATION_SECONDS,
  checkBuildLimitWith,
  countBuildsWith,
  judgeBuild,
  MAX_BUILDS_PER_HOUR,
  MAX_RUNNING_BUILDS,
  RUNNING_RETRY_AFTER_SECONDS,
} from "./limits.mjs";

const counts = (over) => ({
  running: 0,
  lastHour: 0,
  runningFreesInSeconds: undefined,
  hourFreesInSeconds: undefined,
  ...over,
});

describe("judgeBuild", () => {
  it("lets a user under both limits build", () => {
    assert.deepEqual(
      judgeBuild(
        counts({
          running: MAX_RUNNING_BUILDS - 1,
          lastHour: MAX_BUILDS_PER_HOUR - 1,
        })
      ),
      { ok: true }
    );
  });

  it("refuses a build while one runs, asking again when it may have ended", () => {
    assert.deepEqual(
      judgeBuild(counts({ running: MAX_RUNNING_BUILDS, lastHour: 1 })),
      {
        ok: false,
        limit: "running",
        retryAfterSeconds: RUNNING_RETRY_AFTER_SECONDS,
      }
    );
  });

  it("never asks to wait past the time the running row stops counting", () => {
    const verdict = judgeBuild(
      counts({ running: 1, runningFreesInSeconds: 3.2 })
    );
    assert.deepEqual(verdict, {
      ok: false,
      limit: "running",
      retryAfterSeconds: 4,
    });
  });

  it("refuses past the hourly limit until the oldest build leaves the window", () => {
    assert.deepEqual(
      judgeBuild(
        counts({ lastHour: MAX_BUILDS_PER_HOUR, hourFreesInSeconds: 1234.5 })
      ),
      { ok: false, limit: "hourly", retryAfterSeconds: 1235 }
    );
  });

  it("answers with the longer wait when both limits are hit", () => {
    assert.deepEqual(
      judgeBuild(
        counts({
          running: 1,
          lastHour: MAX_BUILDS_PER_HOUR,
          hourFreesInSeconds: 600,
        })
      ),
      { ok: false, limit: "hourly", retryAfterSeconds: 600 }
    );
  });

  it("asks for at least one second", () => {
    const verdict = judgeBuild(
      counts({ lastHour: MAX_BUILDS_PER_HOUR, hourFreesInSeconds: -3 })
    );
    assert.equal(verdict.ok, false);
    assert.equal(verdict.retryAfterSeconds, 1);
  });
});

describe("countBuildsWith", () => {
  it("reads the counts and the seconds `pg` sends as strings", async () => {
    const query = mock.fn(async () => ({
      rows: [
        {
          running: "1",
          last_hour: "5",
          running_frees_in: "42.5",
          hour_frees_in: null,
        },
      ],
    }));

    const result = await countBuildsWith(query)("u1");

    assert.deepEqual(result, {
      running: 1,
      lastHour: 5,
      runningFreesInSeconds: 42.5,
      hourFreesInSeconds: undefined,
    });
    const [text, params] = query.mock.calls[0].arguments;
    assert.match(text, /from build_audit\s+where user_id = \$1/);
    assert.match(text, /status is null/);
    assert.deepEqual(params, ["u1", BUILD_MAX_DURATION_SECONDS, 60 * 60]);
  });

  it("reads no row as no builds", async () => {
    const result = await countBuildsWith(async () => ({ rows: [] }))("u1");
    assert.equal(result.running, 0);
    assert.equal(result.lastHour, 0);
  });
});

describe("checkBuildLimitWith", () => {
  it("lets a database failure through, so the route can refuse", async () => {
    const query = async () => {
      throw new Error("connection refused");
    };
    await assert.rejects(
      checkBuildLimitWith(query)("u1"),
      /connection refused/
    );
  });
});

describe("BUILD_MAX_DURATION_SECONDS", () => {
  it("equals the build route's maxDuration in vercel.json", () => {
    const config = JSON.parse(
      readFileSync(new URL("../../../../vercel.json", import.meta.url), "utf8")
    );
    assert.equal(
      config.functions["api/build-server.mjs"].maxDuration,
      BUILD_MAX_DURATION_SECONDS
    );
  });
});

const DB = process.env.DATABASE_URL;

describe("the count on a real build_audit table", () => {
  it(
    "counts running rows within maxDuration and every row within the hour, for one user",
    { skip: !DB && "DATABASE_URL not set" },
    async () => {
      const pg = (await import("pg")).default;
      const pool = new pg.Pool({ connectionString: DB, max: 1 });
      pool.on("error", () => {});
      const userId = "test-user-build-limits";
      const other = "test-user-build-limits-other";
      const clean = () =>
        pool.query("delete from build_audit where user_id = any($1)", [
          [userId, other],
        ]);
      // `at` is set by hand: the rows say how long ago each build started
      const row = (user, secondsAgo, status) =>
        pool.query(
          `insert into build_audit (user_id, at, unstable, request_bytes, status)
           values ($1, now() - make_interval(secs => $2), false, 1, $3)`,
          [user, secondsAgo, status]
        );

      try {
        await clean();
        await row(userId, 10, undefined); // running
        await row(userId, BUILD_MAX_DURATION_SECONDS + 60, undefined); // function died
        await row(userId, 120, 200); // finished
        await row(userId, 2 * 60 * 60, undefined); // outside the hour
        await row(other, 5, undefined); // someone else's

        const result = await countBuildsWith((text, params) =>
          pool.query(text, params)
        )(userId);

        assert.equal(result.running, 1);
        assert.equal(result.lastHour, 3);
        assert.ok(result.runningFreesInSeconds > 0);
        assert.ok(result.runningFreesInSeconds <= BUILD_MAX_DURATION_SECONDS);
        assert.ok(result.hourFreesInSeconds > 0);
        assert.ok(result.hourFreesInSeconds <= 60 * 60);

        const verdict = await checkBuildLimitWith((text, params) =>
          pool.query(text, params)
        )(userId);
        assert.equal(verdict.ok, false);
        assert.equal(verdict.limit, "running");
      } finally {
        await clean().catch(() => {});
        await pool.end();
      }
    }
  );
});
