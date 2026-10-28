import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import type { ReactNode, RefObject } from "react";

import { useRenderOnChange } from "@/hooks";
import { usePgTheme } from "@/shared/lib/hooks/use-pg-theme";
import { PgConnection, PgView } from "@/utils";
import type { GithubLink } from "../lib/github-links";
import { useFeedbackProvider } from "../model/context";
import { feedbackTelemetry } from "../model/telemetry";
import { useFeedbackForm } from "../model/use-feedback-form";
import { BaseFeedbackForm } from "./BaseFeedbackForm";
import { BaseFeedbackMenuItems } from "./BaseFeedbackMenuItems";

const thank = () =>
  PgView.setToast(
    () => (
      <span>
        <strong>Feedback sent!</strong> Thank you for helping us improve the
        Playground.
      </span>
    ),
    { options: { name: "feedback-sent" } }
  );

// Only for a form the user closed: an open form shows the failure inside itself, where they are reading
const warn = () =>
  PgView.setToast(
    () => (
      <span>
        <strong>Could not send feedback.</strong> Open Share feedback in the
        account menu to try again; what you wrote is kept.
      </span>
    ),
    { options: { name: "feedback-failed" } }
  );

/** What the account menu and its control read from the `FeedbackHost` above them */
interface MenuContext {
  canShare: boolean;
  sending: boolean;
  onShare: () => void;
  onGithub: (link: GithubLink) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

const FeedbackMenuContext = createContext<MenuContext | null>(null);

/**
 * The form and its state, sending through `FeedbackProviderContext`, with the
 * menu entries (`FeedbackMenuItems`) and the send status (`useFeedbackSend`)
 * read anywhere below it. Split so the state sits above what unmounts the
 * account menu: the navigation's footer holds it, and that footer unmounts
 * when the rail swaps it for its own and when the window crosses
 * `LAYOUT_BREAKPOINTS.phone`, so a draft or a send kept beside the menu would
 * go with it.
 */
export const FeedbackHost = ({ children }: { children: ReactNode }) => {
  const provider = useFeedbackProvider();
  const theme = usePgTheme();
  const font = useMemo(
    () => ({
      fontFamily: theme.font.code.family,
      fontSize: theme.font.code.size.medium,
    }),
    [theme]
  );
  // Empty while no account control is mounted; the form then returns focus nowhere
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
  const context = useMemo<MenuContext>(
    () => ({
      canShare: provider.available,
      sending,
      onShare: open,
      onGithub: github("menu"),
      triggerRef: trigger,
    }),
    [provider.available, sending, open, github]
  );

  return (
    <FeedbackMenuContext.Provider value={context}>
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
    </FeedbackMenuContext.Provider>
  );
};

const useMenuContext = (who: string) => {
  const context = useContext(FeedbackMenuContext);
  if (!context) throw new Error(`${who} must be rendered inside FeedbackHost`);
  return context;
};

/** The feedback entries for the account menu, from the `FeedbackHost` above */
export const FeedbackMenuItems = () => {
  const { canShare, onShare, onGithub } = useMenuContext("FeedbackMenuItems");
  return (
    <BaseFeedbackMenuItems
      canShare={canShare}
      onShare={onShare}
      onGithub={onGithub}
    />
  );
};

/**
 * Whether a send is in flight, and the ref the form returns focus to. The
 * account control that is mounted (the footer's row or the rail's "Account")
 * attaches the ref and shows `sending`
 */
export const useFeedbackSend = () => {
  const { sending, triggerRef } = useMenuContext("useFeedbackSend");
  return { sending, triggerRef };
};
