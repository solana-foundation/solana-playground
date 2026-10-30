/**
 * What a signed-in user may spend on `/api/agent` per UTC day, kept in
 * `agent_spend` (see its migration).
 *
 * A turn reserves its worst-case cost before the upstream is called and
 * settles to what it cost once the response has ended. Exact accounting is not
 * the goal: the Gateway's budgets are the ceiling, and the ledger only has to
 * be fair between users. It may overcharge a user, never undercharge them.
 *
 * Every statement runs on a `query` the route passes in -- the persistence
 * slice's, in production. A feature does not import another feature, and a
 * test counts the round trips on the function it hands over.
 */

/** @typedef {"newcomer" | "established"} Tier */

/**
 * @typedef {(text: string, params?: unknown[]) => Promise<{ rows: any[] }>} Query
 */

/** Amounts in the ledger are integers in micro-USD */
const MICRO_PER_USD = 1_000_000;

/** USD to micro-USD, rounded up so a cap or a charge never shrinks */
export const toMicro = (usd) => Math.ceil(usd * MICRO_PER_USD);

/**
 * The UTC date `now` falls on, as `YYYY-MM-DD`: the ledger's day and the
 * Gateway's daily budget reset on the same boundary.
 *
 * @param {Date} now
 */
export const utcDay = (now) => now.toISOString().slice(0, 10);

/**
 * Whole seconds from `now` to the next 00:00 UTC, for `Retry-After`. At
 * least 1, so a refusal at midnight never says "now".
 *
 * @param {Date} now
 */
export const secondsToReset = (now) => {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1
  );
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
};

/**
 * The cost of the token usage an upstream reported, in micro-USD.
 *
 * Prices are USD per million tokens, so tokens times price is micro-USD
 * already. Every input token is charged at the full price, cached or not,
 * which overcharges as the ledger may.
 *
 * @param {{ prompt_tokens?: number; completion_tokens?: number }} usage
 * @param {{ input: number; output: number }} prices USD per million tokens
 */
export const costOf = (usage, prices) =>
  Math.ceil(
    (usage.prompt_tokens ?? 0) * prices.input +
      (usage.completion_tokens ?? 0) * prices.output
  );

/**
 * How a turn ended, which decides its charge:
 *
 * - `refused`: the upstream answered non-2xx, or could not be reached, before
 *   streaming. Nothing was generated.
 * - `abandoned`: the caller left before the upstream was dialled. Nothing was
 *   sent.
 * - `completed`: the stream ended and the upstream reported its usage.
 * - `unfinished`: anything else that got past the upstream's acceptance -- the
 *   caller went away, the stream broke, or it ended without usage.
 *
 * @typedef {{ kind: "refused" }
 *   | { kind: "abandoned" }
 *   | { kind: "completed"; usage: { prompt_tokens?: number; completion_tokens?: number } }
 *   | { kind: "unfinished" }} TurnEnd
 */

/**
 * What a turn is charged, in micro-USD.
 *
 * @param {TurnEnd} end
 * @param {number} reserved the turn's reservation, in micro-USD
 * @param {{ input: number; output: number }} prices USD per million tokens
 */
export const chargeFor = (end, reserved, prices) => {
  if (end.kind === "refused" || end.kind === "abandoned") return 0;
  if (end.kind === "completed") return costOf(end.usage, prices);
  return reserved;
};

/**
 * Decide the caller's tier and reserve `amount` against their cap, in one
 * statement.
 *
 * The tier comes from `"user"."githubCreatedAt"`: `established` when it is set
 * and older than `newcomerAgeDays`, `newcomer` otherwise, including when it is
 * not known yet. The day's row is inserted only when `amount` fits the cap on
 * its own, and updated only when spent, reserved and `amount` together fit.
 * The row lock `on conflict` takes is what keeps two parallel turns from
 * passing the cap together: the second re-reads the row the first wrote.
 *
 * The tier is returned for a refused turn too, because the refusal carries it.
 *
 * @param {Query} query
 * @param {{
 *   userId: string;
 *   day: string;
 *   amount: number;
 *   newcomerAgeDays: number;
 *   caps: Record<Tier, number>;
 * }} turn `amount` and `caps` in micro-USD; `day` from {@link utcDay}
 * @returns {Promise<{ tier: Tier; dated: boolean; admitted: boolean }>}
 *   `dated`: whether the account's creation date is stored
 * @throws when the user has no row, or the database fails: the route answers
 *   503 and calls no upstream
 */
export const reserve = async (query, turn) => {
  const { rows } = await query(
    `with caller as (
       select case
                when "githubCreatedAt" is not null
                 and "githubCreatedAt" < now() - $3::float8 * interval '1 day'
                then 'established'
                else 'newcomer'
              end as tier,
              "githubCreatedAt" is not null as dated
         from "user"
        where id = $1
     ),
     limits as (
       select tier, dated,
              case tier when 'established' then $6::bigint else $5::bigint end
                as cap
         from caller
     ),
     admitted as (
       insert into agent_spend as s (user_id, day, reserved)
       select $1, $2::date, $4::bigint from limits where $4::bigint <= cap
       on conflict (user_id, day) do update
          set reserved = s.reserved + excluded.reserved
        where s.spent + s.reserved + excluded.reserved
              <= (select cap from limits)
       returning 1
     )
     select tier, dated, exists (select 1 from admitted) as admitted
       from limits`,
    [
      turn.userId,
      turn.day,
      turn.newcomerAgeDays,
      turn.amount,
      turn.caps.newcomer,
      turn.caps.established,
    ]
  );
  if (!rows.length) throw new Error(`agent: no user row for ${turn.userId}`);
  const [{ tier, dated, admitted }] = rows;
  return { tier, dated, admitted };
};

/**
 * Replace a turn's reservation with its charge, on the day it was reserved.
 *
 * @param {Query} query
 * @param {{ userId: string; day: string; reserved: number; charge: number }} turn
 *   amounts in micro-USD; `day` the one {@link reserve} was given
 */
export const settle = async (query, turn) => {
  await query(
    `update agent_spend
        set reserved = reserved - $3::bigint,
            spent = spent + $4::bigint
      where user_id = $1 and day = $2::date`,
    [turn.userId, turn.day, turn.reserved, turn.charge]
  );
};
