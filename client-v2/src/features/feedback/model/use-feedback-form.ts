import { useCallback, useRef, useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import type { FeedbackProvider, Rating } from "./provider";
import { feedbackTelemetry } from "./telemetry";

/** `failed` keeps the draft until the user sends it again */
export type SendStatus = "idle" | "sending" | "failed";

/** What the user typed; it outlives a closed form until a send succeeds */
export interface FeedbackDraft {
  message: string;
  contact: string;
  rating?: Rating;
}

export const EMPTY_DRAFT: FeedbackDraft = { message: "", contact: "" };

/** Whether the form shows is independent of the send, which may finish behind a closed form */
export interface FeedbackFormState {
  open: boolean;
  send: SendStatus;
  draft: FeedbackDraft;
}

const log = createLogger("feedback:form");

/**
 * The form's state and its send. A sent feedback closes the form, clears the
 * draft and calls `onSent`; a failed one keeps the draft, and calls
 * `onFailedClosed` when the user is no longer looking at the form.
 */
export const useFeedbackForm = ({
  provider,
  cluster,
  onSent,
  onFailedClosed,
}: {
  provider: FeedbackProvider;
  cluster: string;
  onSent: () => void;
  onFailedClosed: () => void;
}) => {
  const [state, setState] = useState<FeedbackFormState>({
    open: false,
    send: "idle",
    draft: EMPTY_DRAFT,
  });
  // Read when a send settles, which can be after the user closed the form
  const shown = useRef(false);

  const open = useCallback(() => {
    feedbackTelemetry.track("feedback_opened", {});
    shown.current = true;
    setState((current) => ({ ...current, open: true }));
  }, []);

  const close = useCallback(() => {
    shown.current = false;
    setState((current) => ({ ...current, open: false }));
  }, []);

  const edit = useCallback(
    (draft: FeedbackDraft) => setState((current) => ({ ...current, draft })),
    []
  );

  const { draft } = state;
  const submit = useCallback(async () => {
    setState((current) => ({ ...current, send: "sending" }));
    try {
      await provider.send(
        {
          message: draft.message,
          contact: draft.contact.trim() || undefined,
          rating: draft.rating,
        },
        cluster
      );
    } catch (error) {
      log.error(error, { report: true });
      feedbackTelemetry.track("feedback_failed", {});
      setState((current) => ({ ...current, send: "failed" }));
      if (!shown.current) onFailedClosed();
      return;
    }
    feedbackTelemetry.track("feedback_sent", {
      rating: draft.rating ?? "none",
    });
    shown.current = false;
    setState({ open: false, send: "idle", draft: EMPTY_DRAFT });
    onSent();
  }, [draft, provider, cluster, onSent, onFailedClosed]);

  return { state, open, close, edit, submit };
};
