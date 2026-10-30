// Values shared by both halves of the feature: the panel's error mapping under
// `src` and `/api/agent`, which is plain ESM outside the TS build (see
// api/health.mjs). `.mjs` so Node can import it directly; `allowJs` lets the
// TypeScript side import the same file rather than restate it.

/** `reason` on the 429 for a user who has spent today's allowance */
export const DAILY_CAP_REASON = "daily-cap";

/** `reason` on the 503 for a tier whose Gateway budget, or the credit balance, is spent */
export const POOL_EXHAUSTED_REASON = "pool-exhausted";

/**
 * What the panel shows for each limit, and what `/api/agent` sends as
 * `error`. The panel shows its own copy rather than the response's, so no
 * text from the network reaches the chat this way.
 */
export const REFUSAL_MESSAGES = {
  [DAILY_CAP_REASON]:
    "You have used today's free assistant allowance. It resets at 00:00 UTC, " +
    "or bring your own key to keep going.",
  [POOL_EXHAUSTED_REASON]:
    "The free assistant is out of capacity for today. It resets at 00:00 UTC, " +
    "or bring your own key to keep going.",
};

/** The status each limit's refusal carries */
export const REFUSAL_STATUS = {
  [DAILY_CAP_REASON]: 429,
  [POOL_EXHAUSTED_REASON]: 503,
};

/** The tiers a refusal names: `newcomer` for a young or not-yet-dated GitHub account */
export const AGENT_TIERS = ["newcomer", "established"];
