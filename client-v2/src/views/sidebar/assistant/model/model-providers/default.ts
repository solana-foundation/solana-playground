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
    // Not JSON, so not our backend's refusal: the caller shows Spec 08's words
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

/**
 * How `/api/agent` prefixes an upstream failure it relays. Its text is the
 * upstream's, status and body included, so it is never shown.
 */
const UPSTREAM_RELAY = "Upstream ";

/**
 * The sentence `/api/agent` turns a turn away with while it cannot serve one
 * (no default backend, sign-in off or unavailable): a 503 written for people.
 * A relayed upstream 503 is not one of them, and a spent pool is read by
 * `backendRefusal` first.
 */
const ownRefusal = (error: AiTurnError): string | undefined => {
  if (error.status !== 503 || !error.body) return undefined;
  try {
    const parsed = JSON.parse(error.body);
    return typeof parsed?.error === "string" &&
      !parsed.error.startsWith(UPSTREAM_RELAY)
      ? parsed.error
      : undefined;
  } catch {
    // Not JSON, so not our backend's sentence: Spec 08's words are shown
    return undefined;
  }
};

export const defaultProfile: ModelProviderProfile = {
  // The model is the server's to pick, so none is sent and none is shown
  profile: () => ({
    connection: { provider: "default", url: DEFAULT_BACKEND_URL },
    label: "default backend",
    showsReasoning: false,
    backendRefusal,
    ownRefusal,
  }),
};
