import type { ModelProvider } from "@/shared/lib/ai";
import type { NoParams } from "@/shared/lib/telemetry";
import { createTracker } from "@/shared/lib/telemetry";

import type {
  Effort,
  TurnFailureReason,
} from "../../../views/sidebar/assistant/model";

export type AssistantEvents = {
  /** The user picked a model; `via` says whether from the composer's menu or the Connect dialog, where re-picking the connection it opened over is not a pick. */
  assistant_model_picked: { provider: ModelProvider; via: "menu" | "dialog" };
  /** The user changed the reasoning effort in the composer's menu. */
  assistant_effort_changed: { effort: Effort };
  /** The Connect dialog opened; `via` says whether from the head's More, the model chip, a send with nothing connected or the Get set up checklist. */
  assistant_connect_opened: { via: "menu" | "model" | "send" | "setup" };
  /** A prompt was handed to the backend, once per user send: a busy message sent again is the same turn. */
  assistant_turn_sent: { provider: ModelProvider };
  /** The backend's answer completed. */
  assistant_turn_answered: { provider: ModelProvider };
  /** The turn ended without an answer and was not stopped; `reason` is the `TurnFailure`'s, or `other` for a failure raised on this side, and `status` the HTTP status when the backend answered with one. */
  assistant_turn_failed: {
    provider: ModelProvider;
    reason: Exclude<TurnFailureReason, "capped"> | "other";
    status?: number;
  };
  /** The default backend refused the turn under its cost gate; the cap's kind and the tier are on `agent_refused`. */
  assistant_turn_capped: { provider: ModelProvider };
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
  /** The user asked for a described change as a patch ("Make this change" or "Write it for me"). */
  assistant_make_change_requested: NoParams;
};

export const assistantTelemetry = createTracker<AssistantEvents>();
