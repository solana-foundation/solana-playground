import { SIGNED_OUT_REASON } from "../../../../../features/auth";
import {
  AGENT_TIERS,
  DAILY_CAP_REASON,
  POOL_EXHAUSTED_REASON,
  REFUSAL_MESSAGES,
  REFUSAL_STATUS,
} from "@/features/agent";
import type { AgentRefusalReason, AgentTierParam } from "@/features/agent";
import { DEFAULT_BACKEND_URL } from "../../config";
import type { AiTurnError } from "@/shared/lib/ai";
import type { BackendRefusal, ModelProviderProfile } from "./types";

const LIMIT_REASONS: readonly string[] = [
  DAILY_CAP_REASON,
  POOL_EXHAUSTED_REASON,
];

const isLimitReason = (reason: unknown): reason is AgentRefusalReason =>
  typeof reason === "string" && LIMIT_REASONS.includes(reason);

const tierOf = (tier: unknown): AgentTierParam =>
  typeof tier === "string" && AGENT_TIERS.includes(tier)
    ? (tier as AgentTierParam)
    : "unknown";

/**
 * Which refusal `/api/agent` answered a turn with, or `undefined` for any
 * other failure. Read only from our own backend, so another endpoint can
 * never put its text in front of the user this way: a limit's sentence is
 * the panel's own, and a signed-out one only ever comes from our route.
 */
const backendRefusal = (error: AiTurnError): BackendRefusal | undefined => {
  if (!error.body) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(error.body);
  } catch {
    // Not JSON, so not our backend's refusal: the caller shows the SDK's message
    return undefined;
  }

  const reason = parsed?.reason;
  if (
    error.status === 401 &&
    reason === SIGNED_OUT_REASON &&
    typeof parsed.error === "string"
  ) {
    return { kind: "signed-out", message: parsed.error };
  }
  if (isLimitReason(reason) && error.status === REFUSAL_STATUS[reason]) {
    return {
      kind: "limit",
      reason,
      tier: tierOf(parsed.tier),
      message: REFUSAL_MESSAGES[reason],
    };
  }
  return undefined;
};

export const defaultProfile: ModelProviderProfile = {
  // The model is the server's to pick, so none is sent and none is shown
  profile: () => ({
    connection: { provider: "default", url: DEFAULT_BACKEND_URL },
    label: "default backend",
    showsReasoning: false,
    backendRefusal,
  }),
};
