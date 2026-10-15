import { useCallback, useRef } from "react";
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

/** The floating feedback trigger, its menu and the form, sending through `FeedbackProviderContext` */
export const FeedbackWidget = () => {
  const provider = useFeedbackProvider();
  const theme = useTheme();
  const font = {
    fontFamily: theme.font.code.family,
    fontSize: theme.font.code.size.medium,
  };
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

  return (
    <>
      <BaseFeedbackWidget
        canShare={provider.available}
        sending={state.send === "sending"}
        onShare={open}
        onGithub={github("menu")}
        triggerRef={trigger}
        font={font}
      />
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
    </>
  );
};
