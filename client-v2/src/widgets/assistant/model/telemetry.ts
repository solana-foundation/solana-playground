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
  /** The Connect dialog opened; `via` says whether from the head's More, the model chip or a send with nothing connected. */
  assistant_connect_opened: { via: "menu" | "model" | "send" };
  /** The user stopped a turn in progress with the stop button. */
  assistant_turn_stopped: NoParams;
  /** The default backend's probe failed and the default was treated as absent; `reason` says whether the request, the status (not a 404, which is a deployment without the agent) or the body. */
  assistant_default_probe_failed: { reason: "network" | "status" | "body" };
};

export const assistantTelemetry = createTracker<AssistantEvents>();
