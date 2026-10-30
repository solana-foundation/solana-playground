import { createTracker } from "@/shared/lib/telemetry";

/** The limit a default-backend turn was refused by, from the response's `reason` */
export type AgentRefusalReason = "daily-cap" | "pool-exhausted";

/** The caller's tier, from the response's `tier`; `unknown` when it carries none */
export type AgentTierParam = "newcomer" | "established" | "unknown";

type AgentEvents = {
  /**
   * The default backend refused a turn because a limit was reached: the
   * user's daily cap (`daily-cap`) or their tier's Gateway pool
   * (`pool-exhausted`). Tracked once per refused turn, never for a
   * `signed-out` refusal, a 413 or a 503 without a `reason`.
   */
  agent_refused: { reason: AgentRefusalReason; tier: AgentTierParam };
};

export const agentTelemetry = createTracker<AgentEvents>();
