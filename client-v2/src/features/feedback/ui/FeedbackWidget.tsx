import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { useTheme } from "styled-components";

import { useRenderOnChange } from "@/hooks";
import { PgConnection, PgView } from "@/utils";
import type { GithubLink } from "../lib/github-links";
import { useFeedbackProvider } from "../model/context";
import { feedbackTelemetry } from "../model/telemetry";
import { useFeedbackForm } from "../model/use-feedback-form";
import { BaseFeedbackForm } from "./BaseFeedbackForm";
import { BaseFeedbackWidget } from "./BaseFeedbackWidget";

const thank = () =>
  PgView.setToast(() => (
    <span>
      <strong>Feedback sent!</strong> Thank you for helping us improve the
      Playground.
    </span>
  ));

// Only for a form the user closed: an open form shows the failure inside itself, where they are reading
const warn = () =>
  PgView.setToast(() => (
    <span>
      <strong>Could not send feedback.</strong> Open Feedback to try again; what
      you wrote is kept.
    </span>
  ));

/** What `FeedbackTrigger` reads from the `FeedbackHost` above it */
interface TriggerContext {
  canShare: boolean;
  sending: boolean;
  onShare: () => void;
  onGithub: (link: GithubLink) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  font: CSSProperties;
}

const FeedbackTriggerContext = createContext<TriggerContext | null>(null);

/**
 * The form and its state, sending through `FeedbackProviderContext`, with the
 * trigger rendered anywhere below it by `FeedbackTrigger`. Split so the state
 * sits above what unmounts the trigger: the navigation's footer holds it, and
 * on a phone that footer is in a Sheet that unmounts on close, so a draft or a
 * send kept beside the trigger would go with it.
 */
export const FeedbackHost = ({ children }: { children: ReactNode }) => {
  const provider = useFeedbackProvider();
  const theme = useTheme();
  const font = useMemo(
    () => ({
      fontFamily: theme.font.code.family,
      fontSize: theme.font.code.size.medium,
    }),
    [theme]
  );
  // Empty while the trigger is unmounted; the form then returns focus nowhere
  const trigger = useRef<HTMLButtonElement>(null);
  useRenderOnChange(PgConnection.onDidChangeCluster);
  const { state, open, close, edit, submit } = useFeedbackForm({
    provider,
    cluster: PgConnection.cluster ?? "unknown",
    onSent: thank,
    onFailedClosed: warn,
  });

  const github = useCallback(
    (from: "menu" | "form") => (link: GithubLink) =>
      feedbackTelemetry.track("feedback_github_clicked", { link, from }),
    []
  );

  const sending = state.send === "sending";
  const context = useMemo<TriggerContext>(
    () => ({
      canShare: provider.available,
      sending,
      onShare: open,
      onGithub: github("menu"),
      triggerRef: trigger,
      font,
    }),
    [provider.available, sending, open, github, font]
  );

  return (
    <FeedbackTriggerContext.Provider value={context}>
      {children}
      <BaseFeedbackForm
        open={state.open}
        send={state.send}
        draft={state.draft}
        onDraftChange={edit}
        onOpenChange={(next) => (next ? open() : close())}
        onSubmit={submit}
        onGithub={github("form")}
        returnFocusTo={trigger}
        font={font}
      />
    </FeedbackTriggerContext.Provider>
  );
};

/** The "Feedback" button and its menu, for the `FeedbackHost` above it */
export const FeedbackTrigger = () => {
  const context = useContext(FeedbackTriggerContext);
  if (!context) {
    throw new Error("FeedbackTrigger must be rendered inside FeedbackHost");
  }
  return <BaseFeedbackWidget {...context} />;
};
