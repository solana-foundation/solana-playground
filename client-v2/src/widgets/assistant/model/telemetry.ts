import type { ModelProvider } from "@/shared/lib/ai";
import { createTracker } from "@/shared/lib/telemetry";
import type { NoParams } from "@/shared/lib/telemetry";
import type { Effort } from "../../../views/sidebar/assistant/model";

export type AssistantEvents = {
  /** The user picked a model; `via` says whether from the composer's menu or the Connect dialog, where re-picking the connection it opened over is not a pick. */
  assistant_model_picked: { provider: ModelProvider; via: "menu" | "dialog" };
  /** The user changed the reasoning effort in the composer's menu. */
  assistant_effort_changed: { effort: Effort };
  /** The Connect dialog opened; `via` says whether from the head's More, the model chip, a send with nothing connected, a send that reopened the thread's own backend, the Get set up checklist, the Enter key button of a rejected key or the composer's + menu. */
  assistant_connect_opened: {
    via:
      | "menu"
      | "model"
      | "send"
      | "thread"
      | "setup"
      | "key-rejected"
      | "add";
  };
  /** The user stopped a turn in progress with the stop button. */
  assistant_turn_stopped: NoParams;
  /** A turn on a key-based backend ended on the provider refusing the key with a 401. Never the key, the model or the base URL. */
  assistant_key_rejected: { provider: ModelProvider };
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
  /** A reply was cut off: the connection dropped after text had streamed (`reason: "interrupted"`). Other failures show their error and send nothing here. */
  assistant_reply_failed: { reason: "interrupted" };
  /** The user pressed Try again under the last reply; `after` says whether it had been stopped or cut off. */
  assistant_reply_retried: { after: "stopped" | "interrupted" };
  /** The user removed the open-file chip, so the next message goes without that file's content. */
  assistant_file_chip_removed: NoParams;
  /** An applied patch was taken back and its file written back; `via` says from where (only the card's Undo patch so far). */
  assistant_patch_undone: { via: "card" };
};

export const assistantTelemetry = createTracker<AssistantEvents>();
