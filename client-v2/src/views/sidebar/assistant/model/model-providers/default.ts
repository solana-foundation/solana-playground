import { SIGNED_OUT_REASON } from "../../../../../features/auth";
import { DEFAULT_BACKEND_URL } from "../../config";
import type { AiTurnError } from "@/shared/lib/ai";
import type { ModelProviderProfile } from "./types";

/**
 * The sentence `/api/agent` refuses a signed-out turn with. Read only from our
 * own backend, so another endpoint can never put its text in front of the
 * user this way.
 */
const signedOutRefusal = (error: AiTurnError): string | undefined => {
  if (error.status !== 401 || !error.body) return undefined;
  try {
    const parsed = JSON.parse(error.body);
    return parsed?.reason === SIGNED_OUT_REASON &&
      typeof parsed.error === "string"
      ? parsed.error
      : undefined;
  } catch {
    // Not JSON, so not our backend's refusal: the caller shows Spec 08's words
    return undefined;
  }
};

/**
 * How `/api/agent` prefixes an upstream failure it relays. Its text is the
 * upstream's, status and body included, so it is never shown.
 */
const UPSTREAM_RELAY = "Upstream ";

/**
 * The sentence `/api/agent` turns a turn away with while it cannot serve one
 * (no default backend, sign-in off or unavailable): a 503 written for people.
 * A relayed upstream 503 is not one of them.
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
    signedOutRefusal,
    ownRefusal,
  }),
};
