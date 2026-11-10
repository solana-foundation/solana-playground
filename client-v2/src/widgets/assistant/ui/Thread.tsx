import { PgSession } from "@/features/auth";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";

import { useRenderOnChange } from "../../../hooks/useRenderOnChange";
import { backendParamsFrom } from "../../../views/sidebar/assistant/model/backend-params";
import { PgPatchUndo } from "../../../views/sidebar/assistant/patch-undo";
import {
  isConnectionLost,
  isStoppedNotice,
  PgAssistant,
  turnAppliedApproval,
  turnProducedApproval,
} from "../../../views/sidebar/assistant/store";
import { DEFAULT_CONNECTION } from "../model/connection";
import { useDefaultBackend } from "../model/default-backend";
import { isChangeProposal } from "../model/is-change-proposal";
import { useSignInOffer } from "../model/sign-in-offer";
import { assistantTelemetry } from "../model/telemetry";
import type { Turn } from "../model/use-turn";
import type { ApprovalAnswer } from "./BaseApprovalCard";
import { BaseThread } from "./BaseThread";
import type { ReplyActions } from "./BaseThreadItem";

/** The empty thread's first questions, about the open project */
const SUGGESTIONS = [
  "What does this program do?",
  "Why did my build fail?",
  "How do I deploy this?",
] as const;

/**
 * Sent by "Make this change": models often show an edit as a code block in
 * the reply instead of calling `write_file`. This asks for the same edit as a
 * patch, which lands in the usual approval card. It is offered only under
 * such a block (`isChangeProposal`).
 *
 * It leaves the assistant a line to say afterwards, so the turn does not end
 * on a silence the panel has to explain.
 */
const MAKE_CHANGE =
  "Write this change for me, using write_file with the complete new content " +
  "of the file — the change you just described, or the one my question needs " +
  "if you have not described one yet. If it touches more than one file, do " +
  "them one at a time. Skip the explanation you would usually give first and " +
  "summarise it in one line afterwards.";

/**
 * The conversation, connected: the store's items and the turn's `send`, which the composer below shares.
 */
export const Thread = ({
  turn,
  project,
}: {
  turn: Turn;
  project: string | null;
}) => {
  useRenderOnChange(PgAssistant.onDidChange);

  const defaultBackend = useDefaultBackend();

  const items = PgAssistant.items;
  const status = PgAssistant.status;
  const signIn = useSignInOffer({ hasItems: items.length > 0 });
  const { busy } = turn;

  // `useTurn`'s send settles on its own: a failed turn lands in the thread,
  // and a send that fails before its turn starts goes to `reportButtonFailure`
  const send = (text: string) => void turn.send(text);

  // Offer "Make this change" on the reply the assistant just finished, and
  // only there: an older message describes code that has since moved on, and a
  // turn ending in an approval card has already produced its patch. Only a
  // reply that proposes code gets it: an explanation has nothing to apply.
  const lastItem = items[items.length - 1];
  const changeableId =
    !busy &&
    lastItem?.kind === "assistant" &&
    lastItem.text &&
    isChangeProposal(lastItem.text) &&
    !turnProducedApproval(items)
      ? lastItem.id
      : null;

  // Change key goes on a refused key only while nothing has followed it but
  // notices: a reply or a newer error after it means it has been answered,
  // and `recover` is stored with the thread, so it would otherwise come back
  // on every load
  const lastWord = items.findLast((item) => item.kind !== "notice");
  const refused =
    lastWord?.kind === "error"
      ? backendParamsFrom(lastWord.recover)
      : undefined;
  // The refusal, whether or not it still wants an answer. Moving to another
  // backend answers it, which is what stops a second press counting a second
  // pick. Nothing connected is not a move: the key lives in memory, so a reload
  // ends there, still refused
  const connected = PgAssistant.connection;
  const canRecover =
    refused && (!connected || connected.id === refused.provider);

  /**
   * Use hosted model on a refused key: the thread moves to the hosted model
   * and nothing is sent; the refused message goes back in an empty composer
   * for the user to send. The hosted model answers only a signed-in user, so
   * anyone else gets Connect a model on it, where the sign-in is, as the
   * composer's model menu does.
   */
  const handleUseHosted = () => {
    if (!PgSession.get()) {
      turn.openConnect("use-hosted", { provider: "default" });
      return;
    }
    PgAssistant.connect(DEFAULT_CONNECTION);
    assistantTelemetry.track("assistant_model_picked", {
      provider: "default",
      via: "key-rejected",
    });
    const refusedMessage = items.findLast((item) => item.kind === "user");
    if (!turn.input && refusedMessage?.kind === "user") {
      turn.setInput(refusedMessage.text);
    }
  };

  const actionsFor = (id: string): ReplyActions | undefined => {
    const actions: ReplyActions = {};
    if (canRecover && id === lastWord?.id) {
      actions.changeKey = () => turn.openConnect("key-rejected", refused);
      if (defaultBackend.state === "present") {
        actions.useHosted = handleUseHosted;
      }
    }
    if (id === changeableId) {
      actions.makeChange = {
        onClick: () => {
          assistantTelemetry.track("assistant_make_change_requested", {});
          send(MAKE_CHANGE);
        },
      };
    }
    return Object.keys(actions).length ? actions : undefined;
  };

  // Read from the store, not from what was rendered: a second tap lands
  // before the re-render, and only a card still pending is an answer
  const onAnswer = (id: string, answer: ApprovalAnswer) => {
    const card = PgAssistant.items.find((item) => item.id === id);
    if (card?.kind !== "approval" || card.status !== "pending") return;
    assistantTelemetry.track("assistant_approval_answered", {
      kind: card.request.type,
      decision: answer,
    });
    PgAssistant.resolveApproval(id, answer === "allow");
  };

  // Asked on every render: the thread redraws on every change in the store,
  // and an edit in the editor that takes Undo away is caught again by `undo`
  const undoFor = (id: string) => {
    const card = items.find((item) => item.id === id);
    if (card?.kind !== "approval" || !PgPatchUndo.can(card)) return undefined;
    return () => {
      PgPatchUndo.undo(card)
        .then((result) => {
          if (result === "undone") {
            assistantTelemetry.track("assistant_patch_undone", { via: "card" });
          }
        })
        .catch(reportButtonFailure("undo the patch"));
    };
  };

  const originalFor = (id: string) => {
    const card = items.find((item) => item.id === id);
    if (card?.kind !== "approval") return undefined;
    return PgPatchUndo.original(card);
  };

  // Try again sends the last message once more, from the thread's last item
  // only, and only when that item is where a turn was stopped or cut off
  const lastSent = items.findLast((item) => item.kind === "user");
  const retryAfter = (): "stopped" | "interrupted" | undefined => {
    if (busy || !lastItem || lastSent?.kind !== "user") return undefined;
    if (isStoppedNotice(lastItem)) return "stopped";
    // Not once the turn applied a change: sent again, the same request would
    // propose that change over the code it already rewrote
    if (
      (PgAssistant.isCutOff(lastItem) || isConnectionLost(lastItem)) &&
      !turnAppliedApproval(items)
    ) {
      return "interrupted";
    }
    return undefined;
  };
  const after = retryAfter();
  const retryFor = (id: string) => {
    if (!after || id !== lastItem?.id || lastSent?.kind !== "user") {
      return undefined;
    }
    const text = lastSent.text;
    return () => {
      assistantTelemetry.track("assistant_reply_retried", { after });
      send(text);
    };
  };

  // Cover the silent gaps: before the first token and while tools run.
  // Once text streams into the last assistant item the marker comes down.
  const working =
    status === "running" && (lastItem?.kind !== "assistant" || !lastItem.text);

  return (
    <BaseThread
      items={items}
      working={working}
      // From state, not a stored item: it must survive a render reset
      // (`clear`) and must never be saved or synced with the thread
      unsaved={PgAssistant.unsaved}
      signIn={signIn}
      project={project}
      suggestions={SUGGESTIONS}
      onSuggestion={(text) => {
        assistantTelemetry.track("assistant_suggestion_picked", {});
        send(text);
      }}
      actionsFor={actionsFor}
      onAnswer={onAnswer}
      retry={
        turn.retry
          ? {
              secondsLeft: turn.retry.secondsLeft,
              canTryNow: turn.retry.canTryNow,
              onTryNow: turn.tryNow,
              onStop: turn.stop,
            }
          : undefined
      }
      undoFor={undoFor}
      originalFor={originalFor}
      isCutOff={(item) => PgAssistant.isCutOff(item)}
      retryFor={retryFor}
    />
  );
};
