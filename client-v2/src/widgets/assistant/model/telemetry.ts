import { createTracker } from "../../../shared/lib/telemetry";
import type { NoParams } from "../../../shared/lib/telemetry";
import type {
  Effort,
  ProviderId,
} from "../../../views/sidebar/assistant/model";

export type AssistantEvents = {
  /** The user picked a model; `via` says whether from the composer's menu or the Connect dialog, where re-picking the connection it opened over is not a pick. */
  assistant_model_picked: { provider: ProviderId; via: "menu" | "dialog" };
  /** The user changed the reasoning effort in the composer's menu. */
  assistant_effort_changed: { effort: Effort };
  /** The Connect dialog opened; `via` says whether from the head's More, the model chip, a send with nothing connected or the Get set up checklist. */
  assistant_connect_opened: { via: "menu" | "model" | "send" | "setup" };
  /** The user stopped a turn in progress with the stop button. */
  assistant_turn_stopped: NoParams;
  /** The default backend's probe failed and the default was treated as absent; `reason` says whether the request, the status (not a 404, which is a deployment without the agent) or the body. */
  assistant_default_probe_failed: { reason: "network" | "status" | "body" };
  /** The user answered an approval card, once per card; `kind` says whether it proposed a patch or a command. */
  assistant_approval_answered: {
    kind: "patch" | "command";
    answer: "allow" | "deny";
  };
  /** The user picked one of the empty thread's suggestions, which sends it (or, with nothing connected, opens Connect a model). */
  assistant_suggestion_picked: NoParams;
  /** The user pressed "Sign in with GitHub" on the line a signed-out thread ends in; the sign-in's outcome is `auth`'s events. */
  assistant_sign_in_offered_clicked: NoParams;
  /** The user asked for a described change as a patch ("Make this change" or "Write it for me"). */
  assistant_make_change_requested: NoParams;
};

export const assistantTelemetry = createTracker<AssistantEvents>();
