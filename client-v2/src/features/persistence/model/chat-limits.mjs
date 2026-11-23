// What one account may store in conversations (HOO-2882), read by
// `POST /api/conversations` and by the assistant panel that names a refusal.
// `.mjs` so Node runs it as written; `allowJs` lets the browser import it.
//
// The figures sit in line with the project caps (`ACCOUNT_LIMITS` in
// `entities/project/limits.mjs`): 10 projects and 32 tutorials of at most
// 512 KiB each come to about 21 MiB of code an account can sync. A
// conversation is the same order. One push is capped apart, by
// `MAX_BATCH_BYTES` and `MAX_BATCH_ITEMS` in `chat-batch.mjs`.

/** The three caps, over the account's live conversations */
export const CHAT_LIMITS = Object.freeze({
  /** Conversations not deleted with their project */
  threads: 200,
  /** Messages in those conversations */
  messages: 20_000,
  /** Their stored payloads, in UTF-8 bytes */
  bytes: 32 * 1024 * 1024,
});

/**
 * Which cap a push was refused for, with the cap and the measure the push
 * would have made: the body of the route's 413, and what the panel names.
 *
 * @typedef {{reason: "too-many-threads" | "too-many-messages"
 *   | "conversations-too-large", limit: number, count: number}} ChatLimitExceeded
 */

/** @typedef {ChatLimitExceeded["reason"]} ChatLimitReason */

/**
 * Each reason with the cap it names, in the order a push is checked against
 * them: when a push breaks several, the first is the one reported.
 *
 * @type {ReadonlyArray<[ChatLimitReason, keyof typeof CHAT_LIMITS]>}
 */
export const CHAT_LIMIT_ORDER = Object.freeze([
  ["too-many-threads", "threads"],
  ["too-many-messages", "messages"],
  ["conversations-too-large", "bytes"],
]);

/**
 * The `reason` of the 409 a push gets when its project id names no project
 * row of the account. A conversation no longer creates one: a project row
 * comes only from `PUT /api/projects`, under the project cap.
 */
export const NO_PROJECT_REASON = "no-project";

/** @param {unknown} value */
const isCount = (value) => Number.isInteger(value) && Number(value) >= 0;

/**
 * A 413 body read into a `ChatLimitExceeded`, or `null` when it is not one:
 * the body cap's `too-large`, a proxy's page, or a body missing a field. Every
 * field is checked and copied, nothing else is, so a body from a server that
 * differs from this client cannot reach the panel's wording.
 *
 * @param {unknown} body
 * @returns {ChatLimitExceeded | null}
 */
export const readChatLimitExceeded = (body) => {
  // eslint-disable-next-line unicorn/no-null -- the contract: `null` is "none"
  if (!body || typeof body !== "object") return null;
  const b = /** @type {Record<string, unknown>} */ (body);
  const known = CHAT_LIMIT_ORDER.some(([reason]) => reason === b.reason);
  // eslint-disable-next-line unicorn/no-null -- the contract: `null` is "none"
  if (!known || !isCount(b.limit) || !isCount(b.count)) return null;
  return {
    reason: /** @type {ChatLimitReason} */ (b.reason),
    limit: /** @type {number} */ (b.limit),
    count: /** @type {number} */ (b.count),
  };
};
