/**
 * What a signed-in user may spend on `/api/agent` per UTC day, kept in
 * `agent_spend` (see its migration), and each admitted turn, kept in
 * `agent_turn`.
 *
 * A turn reserves its worst-case cost before the upstream is called and
 * settles to what it cost once the response has ended. Exact accounting is not
 * the goal: the upstream keys' spend limits are the ceiling, and the ledger only has to
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
 * The UTC date `now` falls on, as `YYYY-MM-DD`: the ledger's day, on which a
 * user's daily cap resets.
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
 * which overcharges as the ledger may. Charges a completed turn: alone when
 * the upstream reported no cost, and as the floor under the cost it reported.
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
 *   | { kind: "completed"; usage: import("./stream-usage.mjs").Usage }
 *   | { kind: "unfinished" }} TurnEnd
 */

/** The largest count a Postgres `integer` holds */
const MAX_TOKENS = 2 ** 31 - 1;

/**
 * A token count fit for `agent_turn`, or null. The usage comes from the
 * upstream, and a count that is fractional, negative, out of range or not a
 * number would fail the statement that also settles the turn's charge.
 *
 * @param {unknown} count
 * @returns {number | null}
 */
const tokenCount = (count) =>
  Number.isSafeInteger(count) && count >= 0 && count <= MAX_TOKENS
    ? count
    : // eslint-disable-next-line unicorn/no-null -- stored in `agent_turn`: SQL `NULL` for a count it cannot hold
      null;

/**
 * What a turn is charged, in micro-USD. A completed turn is charged the larger
 * of the cost the upstream reported (`usage.cost`, in USD) and its tokens at
 * `prices`, so an upstream that reports too little, as the Gateway reported
 * `cost: 0` for a free-tier turn on 2026-10-29, cannot undercharge; the
 * reported cost wins when the upstream's price is above `prices`. With only
 * one of the two, that one; with neither, its reservation, as a turn that
 * reported no usage.
 *
 * @param {TurnEnd} end
 * @param {number} reserved the turn's reservation, in micro-USD
 * @param {{ input: number; output: number }} prices USD per million tokens
 */
export const chargeFor = (end, reserved, prices) => {
  if (end.kind === "refused" || end.kind === "abandoned") return 0;
  if (end.kind !== "completed") return reserved;
  const reported = reportedCost(end.usage.cost);
  const priced = isPriceable(end.usage) ? costOf(end.usage, prices) : undefined;
  if (reported === undefined) return priced ?? reserved;
  return priced === undefined ? reported : Math.max(reported, priced);
};

/**
 * The upstream's reported cost in micro-USD, or undefined when it reported
 * none, or one the ledger cannot use: not a number, negative, or too large
 * for a JS number to hold exactly in micro-USD.
 *
 * @param {unknown} cost USD
 * @returns {number | undefined}
 */
const reportedCost = (cost) => {
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
    return undefined;
  }
  const micro = toMicro(cost);
  return Number.isSafeInteger(micro) ? micro : undefined;
};

/**
 * Whether reported usage can be priced: each count the upstream gave is one
 * {@link tokenCount} accepts. A missing count is priced as none, as
 * {@link costOf} does; one that is NaN, negative, fractional or out of range
 * would make the charge one the ledger cannot store.
 *
 * @param {{ prompt_tokens?: unknown; completion_tokens?: unknown }} usage
 */
const isPriceable = (usage) =>
  [usage.prompt_tokens, usage.completion_tokens].every(
    (count) => count === undefined || tokenCount(count) !== null
  );

/**
 * What {@link reserve} decided. An admitted turn carries the id of its
 * `agent_turn` row, which {@link settle} ends; a refused one has no row.
 * `dated`: whether the account's creation date is stored.
 *
 * @typedef {{ tier: Tier; dated: boolean; admitted: true; turnId: string }
 *   | { tier: Tier; dated: boolean; admitted: false }} Gate
 */

/**
 * Decide the caller's tier, reserve `amount` against their cap and record an
 * admitted turn as `started` in `agent_turn`, in one statement.
 *
 * The tier comes from `"user"."githubCreatedAt"`: `established` when it is set
 * and older than `newcomerAgeDays`, `newcomer` otherwise, including when it is
 * not known yet. The day's row is inserted only when `amount` fits the cap on
 * its own, and updated only when spent, reserved and `amount` together fit.
 * The row lock `on conflict` takes is what keeps two parallel turns from
 * passing the cap together: the second re-reads the row the first wrote.
 *
 * The turn row is written only when the reserve was admitted, charged the
 * reservation until {@link settle} replaces it, and names `model`. Writing it
 * here rather than at settle keeps a turn whose function is killed before it
 * settles: its row stays `started`.
 *
 * The tier is returned for a refused turn too, because the refusal carries it.
 *
 * @param {Query} query
 * @param {{
 *   userId: string;
 *   day: string;
 *   amount: number;
 *   model: string;
 *   newcomerAgeDays: number;
 *   caps: Record<Tier, number>;
 * }} turn `amount` and `caps` in micro-USD; `day` from {@link utcDay};
 *   `model` the one the upstream is asked for
 * @returns {Promise<Gate>}
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
     ),
     started as (
       insert into agent_turn
         (user_id, day, tier, model, outcome, charged, settled_at)
       select $1, $2::date, tier, $7, 'started', $4::bigint, null
         from limits
        where exists (select 1 from admitted)
       returning id
     )
     select tier, dated, (select id::text from started) as turn_id
       from limits`,
    [
      turn.userId,
      turn.day,
      turn.newcomerAgeDays,
      turn.amount,
      turn.caps.newcomer,
      turn.caps.established,
      turn.model,
    ]
  );
  if (!rows.length) throw new Error(`agent: no user row for ${turn.userId}`);
  const [{ tier, dated, turn_id: turnId }] = rows;
  // A turn row is written exactly when the reserve is admitted. Anything but
  // an id or SQL `NULL` is a statement that changed shape: fail closed.
  if (turnId === null) return { tier, dated, admitted: false };
  if (typeof turnId !== "string" || !turnId) {
    throw new Error(`agent: reserve returned no turn id (${typeof turnId})`);
  }
  return { tier, dated, admitted: true, turnId };
};

/**
 * End a `started` turn: write how it ended to its `agent_turn` row and move
 * its reservation into its charge on the `agent_spend` day the row names, in
 * one statement, so the route makes one round trip after the response.
 * Tokens the upstream reported that `agent_turn` cannot hold are recorded as
 * null rather than failing the settle.
 *
 * The reservation released is the one the row holds, so `agent_spend` gives
 * back exactly what {@link reserve} took. Only a row still `started` is
 * settled, and `agent_spend` moves only with it: settling a turn twice
 * charges it once, and a turn with no `started` row changes nothing. A row
 * removed on its own (not with its user, which removes the day too) leaves
 * its reservation spent for the day, an overcharge, never an undercharge.
 *
 * @param {Query} query
 * @param {{ turnId: string; charge: number; end: TurnEnd }} turn `turnId`
 *   the one {@link reserve} returned; `charge` in micro-USD; `end` how the
 *   turn ended, whose usage is recorded for a `completed` turn only
 * @returns {Promise<boolean>} whether a `started` turn was found and settled
 */
export const settle = async (query, turn) => {
  const usage = turn.end.kind === "completed" ? turn.end.usage : {};
  // `held` is the row as the statement found it: its `charged` is still the
  // reservation, which RETURNING on `t` alone would give as the new charge
  const { rows } = await query(
    `with ended as (
       update agent_turn t
          set outcome = $3,
              prompt_tokens = $4::integer,
              completion_tokens = $5::integer,
              charged = $2::bigint,
              settled_at = now()
         from agent_turn held
        where t.id = $1::bigint and held.id = t.id and t.outcome = 'started'
       returning t.user_id, t.day, held.charged as reserved
     ),
     settled as (
       update agent_spend s
          set reserved = s.reserved - ended.reserved,
              spent = s.spent + $2::bigint
         from ended
        where s.user_id = ended.user_id and s.day = ended.day
     )
     select count(*)::int as ended from ended`,
    [
      turn.turnId,
      turn.charge,
      turn.end.kind,
      tokenCount(usage.prompt_tokens),
      tokenCount(usage.completion_tokens),
    ]
  );
  return rows[0].ended > 0;
};

/**
 * Count a turn the daily cap refused on the day's row. It reserved nothing,
 * so there is nothing to settle; the count is what lets the quota's shape see
 * refusals. A turn larger than the whole cap is refused on a day with no row
 * yet, so this inserts one.
 *
 * @param {Query} query
 * @param {{ userId: string; day: string }} turn `day` from {@link utcDay}
 */
export const recordCapped = async (query, turn) => {
  await query(
    `insert into agent_spend as s (user_id, day, capped)
     values ($1, $2::date, 1)
     on conflict (user_id, day) do update set capped = s.capped + 1`,
    [turn.userId, turn.day]
  );
};
