import type { ModelProvider } from "@/shared/lib/ai";
import type { NoParams } from "@/shared/lib/telemetry";
import { createTracker } from "@/shared/lib/telemetry";

import type { Effort } from "../../../views/sidebar/assistant/model";
import type { TurnFailureReason } from "../../../views/sidebar/assistant/model/types";
import type { AiOffReason } from "./ai-off";

/** Why a turn failed, as `assistant_turn_failed` reports it: the provider's reasons but the cap, which is its own event, and `other` for a failure raised on this side */
export type TurnFailedReason = Exclude<TurnFailureReason, "capped"> | "other";

export type AssistantEvents = {
  /** The user picked a model; `via` says whether from the composer's menu, the Connect dialog, where re-picking the connection it opened over is not a pick, or Use hosted model on a rejected key's error. */
  assistant_model_picked: {
    provider: ModelProvider;
    via: "menu" | "dialog" | "key-rejected";
  };
  /** The user changed the reasoning effort in the composer's menu. */
  assistant_effort_changed: { effort: Effort };
  /** The Connect dialog opened; `via` says whether from the head's More, the model chip, a send with nothing connected, a send that reopened the thread's own backend, the Get set up checklist, the Change key button of a rejected key (or its Use hosted model when signed out), the composer's + menu or the off row's Add an API key. */
  assistant_connect_opened: {
    via:
      | "menu"
      | "model"
      | "send"
      | "thread"
      | "setup"
      | "key-rejected"
      | "add"
      | "ai-off";
  };
  /** The composer's off row appeared, once per reason while the composer stays mounted (Sources and tools unmounts it); `reason` says whether the deployment has no hosted key, the user is signed out of the hosted model, or the hosted model could not be reached. */
  assistant_ai_off_shown: { reason: AiOffReason };
  /** The user stopped a turn with the stop button, while it ran or while it counted down to sending a busy message again; it is then the turn's only outcome. */
  assistant_turn_stopped: NoParams;
  /** A message went to the backend as a new turn: once per message, not again when a busy model's resend sends it a second time. Never the prompt. It ends with one outcome (answered, failed, capped or stopped), except a turn the store cuts off (its thread closed, the backend changed, a sign-out) or a busy message dropped because the conversation changed, which end with none. */
  assistant_turn_sent: { provider: ModelProvider };
  /** The turn's answer completed, including one whose answer was empty (the thread then says so as an error: the backend did answer); one of the four outcomes of a sent turn. */
  assistant_turn_answered: { provider: ModelProvider };
  /** The turn ended without an answer and was not stopped or capped. `reason`: the backend answered with an error or did not answer (`provider`), the model refused (`refusal`), it kept pausing (`paused`), or this side ended it (`other`). `status` is the backend's HTTP status, absent when there was none. Never the error's text. */
  assistant_turn_failed: {
    provider: ModelProvider;
    reason: TurnFailedReason;
    status?: number;
  };
  /** The default backend's cost gate refused the turn (daily cap or exhausted pool); the kind and tier are on `agent_refused`. */
  assistant_turn_capped: { provider: ModelProvider };
  /** The user picked Delete my key in the head's More: the key and the backend are dropped. Never the key or the provider. */
  assistant_key_deleted: NoParams;
  /** A turn on a key-based backend ended on the provider refusing the key with a 401. Never the key, the model or the base URL. */
  assistant_key_rejected: { provider: ModelProvider };
  /** The probe of `GET /api/ai/status` failed and the hosted model was treated as unreachable; `reason` says whether the request, the status (not a 404, which is a deployment without the route), the body, or the server's reading of the session (`reason: "unavailable"` in the answer). */
  assistant_default_probe_failed: {
    reason: "network" | "status" | "body" | "session";
  };
  /** The user pressed Try again in the composer's off row, which asks `GET /api/ai/status` again. */
  assistant_default_probe_retried: NoParams;
  /** The user answered an approval card, once per card; `kind` says whether it proposed a patch or a command. */
  assistant_approval_answered: {
    kind: "patch" | "command";
    answer: "allow" | "deny";
  };
  /** The user picked one of the empty thread's suggestions, which sends it (or, with nothing connected, opens Connect a model). */
  assistant_suggestion_picked: NoParams;
  /** The user asked for a described change as a patch ("Make this change" or "Write it for me"). */
  assistant_make_change_requested: NoParams;
  /** The connection dropped during a turn: after text had streamed, cutting the reply off (`reason: "interrupted"`), or before any (`reason: "connection-lost"`). Other failures show their error and send nothing here. */
  assistant_reply_failed: { reason: "interrupted" | "connection-lost" };
  /** The user pressed Try again under the last reply; `after` says whether it had been stopped or cut off. */
  assistant_reply_retried: { after: "stopped" | "interrupted" };
  /** The user removed a file's chip, so that file stays out of every message until it is added back. */
  assistant_file_chip_removed: NoParams;
  /** The user added a file to the assistant's context; `via` says from where (only the composer's + › Add a file so far). */
  assistant_context_file_added: { via: "menu" };
  /** An applied patch was taken back and its file written back; `via` says from where (only the card's Undo patch so far). */
  assistant_patch_undone: { via: "card" };
};

export const assistantTelemetry = createTracker<AssistantEvents>();
