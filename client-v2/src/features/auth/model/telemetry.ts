import { createTracker } from "../../../shared/lib/telemetry";
import type { NoParams } from "../../../shared/lib/telemetry";
import type { PopupChannelFailure } from "../lib/popup-channel";

/** Why a sign-in ended without a session */
export type SignInFailure =
  | "request-failed"
  | "popup-blocked"
  | PopupChannelFailure;

type AuthEvents = {
  /** The user asked to sign in with GitHub, before the popup opens. */
  auth_sign_in_started: NoParams;
  /** The popup reported success and the session was re-read. */
  auth_signed_in: NoParams;
  /** The sign-in ended without a session; `reason` says at which step. */
  auth_sign_in_failed: { reason: SignInFailure };
  /** The user signed out. */
  auth_signed_out: NoParams;
};

export const authTelemetry = createTracker<AuthEvents>();
