import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import pg from "pg";

import {
  chargeFor,
  costOf,
  recordCapped,
  reserve,
  secondsToReset,
  settle,
  toMicro,
  utcDay,
} from "./ledger.mjs";

const PRICES = { input: 0.15, output: 0.5 };

describe("ledger arithmetic", () => {
  it("counts the seconds to the next 00:00 UTC", () => {
    assert.equal(secondsToReset(new Date("2026-10-29T23:59:00Z")), 60);
    assert.equal(secondsToReset(new Date("2026-10-29T00:00:00Z")), 86400);
    assert.equal(secondsToReset(new Date("2026-10-29T23:59:59.500Z")), 1);
  });

  it("names the UTC day, whatever the local zone", () => {
    assert.equal(utcDay(new Date("2026-10-29T23:30:00-05:00")), "2026-10-30");
  });

  it("prices reported usage in micro-USD", () => {
    // 1M input at $0.15 and 1M output at $0.50
    assert.equal(
      costOf({ prompt_tokens: 1e6, completion_tokens: 1e6 }, PRICES),
      650000
    );
    assert.equal(toMicro(0.1), 100000);
  });

  it("charges usage, the reservation, or nothing, by how the turn ended", () => {
    const usage = { prompt_tokens: 1000, completion_tokens: 100 };
    assert.equal(chargeFor({ kind: "completed", usage }, 9999, PRICES), 200);
    assert.equal(chargeFor({ kind: "unfinished" }, 9999, PRICES), 9999);
    assert.equal(chargeFor({ kind: "refused" }, 9999, PRICES), 0);
    assert.equal(chargeFor({ kind: "abandoned" }, 9999, PRICES), 0);
  });

  // The upstream's usage is not ours: a count that cannot be priced charges
  // the reservation, never NaN, a negative or an overflow
  for (const bad of ["x", -1, 2.5, 2 ** 31, Number.NaN, null]) {
    it(`charges the reservation for a completed turn reporting ${String(
      bad
    )} tokens`, () => {
      const usage = { prompt_tokens: bad, completion_tokens: 100 };
      assert.equal(chargeFor({ kind: "completed", usage }, 9999, PRICES), 9999);
    });
  }

  it("prices a count the upstream left out as none", () => {
    const usage = { completion_tokens: 100 };
    assert.equal(chargeFor({ kind: "completed", usage }, 9999, PRICES), 50);
  });
});

// `yarn test-api` loads `.env`; without a database this suite skips rather
// than fails, which is what lets the unit suites run on their own.
const DB = process.env.DATABASE_URL;

// A pool of the test's own: the route's comes from `persistence`, which a
// feature may not import. The ledger takes any `query` of that shape.
const pool = DB && new pg.Pool({ connectionString: DB });
const query = (text, params) => pool.query(text, params);
after(() => pool && pool.end());

describe("ledger", { skip: !DB && "DATABASE_URL not set" }, () => {
  const NEW = "test-user-ledger-new";
  const OLD = "test-user-ledger-old";
  const OTHER = "test-user-ledger-other";
  const DAY = "2026-10-29";
  const CAPS = { newcomer: 100000, established: 500000 };

  const addUser = (id, githubCreatedAt) =>
    query(
      `insert into "user" (id, name, email, "emailVerified", "githubCreatedAt")
       values ($1, 'Test', $1 || '@example.com', false, $2)
       on conflict (id) do update set "githubCreatedAt" = excluded."githubCreatedAt"`,
      [id, githubCreatedAt]
    );

  before(async () => {
    await addUser(NEW, null);
    await addUser(OLD, "2011-01-25T18:44:36Z");
    await addUser(OTHER, null);
  });

  beforeEach(async () => {
    await query("delete from agent_spend where user_id = any($1)", [
      [NEW, OLD, OTHER],
    ]);
    await query("delete from agent_turn where user_id = any($1)", [
      [NEW, OLD, OTHER],
    ]);
  });

  /** The turns recorded for `userId`, oldest first */
  const turns = async (userId) => {
    const { rows } = await query(
      `select to_char(day, 'YYYY-MM-DD') as day, tier, outcome, prompt_tokens,
            completion_tokens, charged::int
       from agent_turn where user_id = $1 order by id`,
      [userId]
    );
    return rows;
  };

  /** A settle of a newcomer's turn that ended `unfinished`, unless told otherwise */
  const close = (userId, reserved, charge, turn = {}, run = query) =>
    settle(run, {
      userId,
      day: DAY,
      reserved,
      charge,
      tier: turn.tier ?? "newcomer",
      end: turn.end ?? { kind: "unfinished" },
    });

  /** The count of capped turns on `userId`'s day row */
  const capped = async (userId) => {
    const { rows } = await query(
      `select capped from agent_spend where user_id = $1 and day = $2`,
      [userId, DAY]
    );
    return rows[0]?.capped;
  };

  /** A reservation of `amount` for `userId` on `day` */
  const take = (userId, amount, day = DAY, run = query) =>
    reserve(run, { userId, day, amount, newcomerAgeDays: 30, caps: CAPS });

  const row = async (userId, day = DAY) => {
    const { rows } = await query(
      `select reserved::int, spent::int from agent_spend
        where user_id = $1 and day = $2`,
      [userId, day]
    );
    return rows[0];
  };

  it("reads a missing creation date as a newcomer", async () => {
    assert.deepEqual(await take(NEW, 1), {
      tier: "newcomer",
      dated: false,
      admitted: true,
    });
  });

  it("reads an old creation date as established", async () => {
    assert.deepEqual(await take(OLD, 1), {
      tier: "established",
      dated: true,
      admitted: true,
    });
  });

  it("reads a recent creation date as a newcomer", async () => {
    await addUser(OTHER, new Date(Date.now() - 86400 * 1000).toISOString());
    try {
      const gate = await take(OTHER, 1);
      assert.equal(gate.tier, "newcomer");
      assert.equal(gate.dated, true);
    } finally {
      await addUser(OTHER, null);
    }
  });

  it("refuses a reserve at the cap, and still names the tier", async () => {
    await take(NEW, CAPS.newcomer);
    assert.deepEqual(await take(NEW, 1), {
      tier: "newcomer",
      dated: false,
      admitted: false,
    });
    assert.deepEqual(await row(NEW), { reserved: CAPS.newcomer, spent: 0 });
  });

  it("refuses a single turn costing more than the cap on an empty day", async () => {
    assert.equal((await take(NEW, CAPS.newcomer + 1)).admitted, false);
    assert.equal(await row(NEW), undefined);
  });

  it("admits one of two parallel reserves at the edge", async () => {
    await take(NEW, CAPS.newcomer - 600);

    const both = await Promise.all([take(NEW, 500), take(NEW, 500)]);

    assert.deepEqual(both.map((gate) => gate.admitted).sort(), [false, true]);
    assert.equal((await row(NEW)).reserved, CAPS.newcomer - 100);
  });

  it("holds an established user to the established cap, not the newcomer's", async () => {
    await take(OLD, CAPS.established - 600);

    const both = await Promise.all([take(OLD, 500), take(OLD, 500)]);

    assert.deepEqual(both.map((gate) => gate.admitted).sort(), [false, true]);
    assert.ok(both.every((gate) => gate.tier === "established"));
    assert.equal((await row(OLD)).reserved, CAPS.established - 100);
  });

  // No row yet: both insert, and the second falls through to the update
  it("admits one of two parallel first reserves of the day", async () => {
    const both = await Promise.all([take(NEW, 60000), take(NEW, 60000)]);

    assert.deepEqual(both.map((gate) => gate.admitted).sort(), [false, true]);
    assert.equal((await row(NEW)).reserved, 60000);
  });

  it("settles a reservation to its charge", async () => {
    await take(NEW, 5000);
    await close(NEW, 5000, 1200);
    assert.deepEqual(await row(NEW), { reserved: 0, spent: 1200 });
  });

  it("records the settled turn with its tokens and charge", async () => {
    await take(OLD, 5000);
    await close(OLD, 5000, 1200, {
      tier: "established",
      end: {
        kind: "completed",
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      },
    });
    assert.deepEqual(await turns(OLD), [
      {
        day: DAY,
        tier: "established",
        outcome: "completed",
        prompt_tokens: 100,
        completion_tokens: 20,
        charged: 1200,
      },
    ]);
    assert.equal((await row(OLD)).spent, 1200);
  });

  it("records an unfinished turn with no tokens, charged its reservation", async () => {
    await take(NEW, 5000);
    await close(NEW, 5000, 5000);
    assert.deepEqual(await turns(NEW), [
      {
        day: DAY,
        tier: "newcomer",
        outcome: "unfinished",
        prompt_tokens: null,
        completion_tokens: null,
        charged: 5000,
      },
    ]);
  });

  it("records the turn even when the day has no row to settle", async () => {
    await close(NEW, 10, 0, { end: { kind: "refused" } });
    assert.equal((await turns(NEW)).length, 1);
    assert.equal(await row(NEW), undefined);
  });

  // The upstream's usage is not ours: a count `agent_turn` cannot hold must not
  // fail the statement that settles the charge
  for (const bad of [2.5, "12", -1, 2 ** 31, Number.NaN]) {
    it(`settles a turn whose upstream reported ${String(
      bad
    )} tokens`, async () => {
      await take(NEW, 5000);
      await close(NEW, 5000, 1200, {
        end: {
          kind: "completed",
          usage: { prompt_tokens: bad, completion_tokens: 7 },
        },
      });
      assert.deepEqual(await row(NEW), { reserved: 0, spent: 1200 });
      const [turn] = await turns(NEW);
      assert.equal(turn.prompt_tokens, null);
      assert.equal(turn.completion_tokens, 7);
    });
  }

  it("refuses tokens on a turn that did not complete", async () => {
    await assert.rejects(
      query(
        `insert into agent_turn (user_id, day, tier, outcome, prompt_tokens)
         values ($1, $2, 'newcomer', 'refused', 5)`,
        [NEW, DAY]
      ),
      /agent_turn_tokens_check/
    );
  });

  it("counts turns the cap refused on the day's row, without a turn row", async () => {
    await take(NEW, CAPS.newcomer);
    await recordCapped(query, { userId: NEW, day: DAY });
    await recordCapped(query, { userId: NEW, day: DAY });
    assert.equal(await capped(NEW), 2);
    assert.deepEqual(await row(NEW), { reserved: CAPS.newcomer, spent: 0 });
    assert.deepEqual(await turns(NEW), []);
  });

  it("counts a refusal on a day with no row yet", async () => {
    await recordCapped(query, { userId: NEW, day: DAY });
    assert.equal(await capped(NEW), 1);
    assert.deepEqual(await row(NEW), { reserved: 0, spent: 0 });
  });

  it("counts settled spend against the cap", async () => {
    await take(NEW, 90000);
    await close(NEW, 90000, 90000);
    assert.equal((await take(NEW, 20000)).admitted, false);
    assert.equal((await take(NEW, 10000)).admitted, true);
  });

  it("starts the cap again on the next UTC day", async () => {
    await take(NEW, CAPS.newcomer);
    assert.equal((await take(NEW, 1)).admitted, false);
    assert.equal((await take(NEW, 1, "2026-10-30")).admitted, true);
  });

  it("does not share a cap between users", async () => {
    await take(NEW, CAPS.newcomer);
    assert.equal((await take(OTHER, 1)).admitted, true);
  });

  it("takes one round trip to reserve and one to settle", async () => {
    let count = 0;
    const counted = (text, params) => {
      count += 1;
      return query(text, params);
    };

    await take(NEW, 10, DAY, counted);
    assert.equal(count, 1);
    await close(NEW, 10, 5, {}, counted);
    assert.equal(count, 2);
  });

  it("throws for a user with no row, so the route fails closed", async () => {
    await assert.rejects(take("test-user-ledger-missing", 1), /no user row/);
  });
});
