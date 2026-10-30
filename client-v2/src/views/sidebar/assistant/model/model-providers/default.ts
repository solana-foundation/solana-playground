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
 *
 * TODO(after polish-3 and ai-rail land): `api/agent.mjs` writes this prefix
 * itself; mark the relay with a field both import (as `SIGNED_OUT_REASON`)
 * instead. Kept as polish-3 has it until then, so the landing merge stays clean.
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

/**
 * How `/api/agent` relays a status the upstream answered with, as against a
 * fault of its own ("Upstream unreachable", its key refused upstream)
 */
// "Upstream 503: …", never its own "Upstream 200 with no body to stream."
const RELAYED_STATUS = new RegExp(`^${UPSTREAM_RELAY}\\d{3}: `);

/**
 * Whether an outage is this backend's own fault, ours to hear of: not its
 * relay of the upstream's status, which is on the provider's status page. Its
 * own 503 sentences never reach here (`ownRefusal` shows them first), and a
 * deployment with no default backend is one of them, served as designed.
 */
const reportsOutage = (error: AiTurnError): boolean => {
  if (!error.body) return true;
  try {
    const parsed = JSON.parse(error.body);
    return !(
      typeof parsed?.error === "string" && RELAYED_STATUS.test(parsed.error)
    );
  } catch {
    // Not JSON, so not `/api/agent`'s relay: a platform page in front of it, ours
    return true;
  }
};

// TODO(after polish-3 and ai-rail land): a 403 or 404 from `/api/agent` is a
// deployment of ours gone wrong (origin not allowed, route or model missing),
// yet reads as the user's key or model and goes unreported; give this profile
// its own words and reporting for them
export const defaultProfile: ModelProviderProfile = {
  // The model is the server's to pick, so none is sent and none is shown
  profile: () => ({
    connection: { provider: "default", url: DEFAULT_BACKEND_URL },
    label: "default backend",
    showsReasoning: false,
    signedOutRefusal,
    ownRefusal,
    reportsOutage,
  }),
};
