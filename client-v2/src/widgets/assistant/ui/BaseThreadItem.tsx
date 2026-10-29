import { CheckIcon } from "lucide-react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Bubble, BubbleContent } from "@/shared/ui/bubble";
import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { Marker, MarkerContent, MarkerIcon } from "@/shared/ui/marker";
import { Message, MessageContent, MessageFooter } from "@/shared/ui/message";
import Markdown from "../../../components/Markdown";
import type { ChatItem } from "../../../views/sidebar/assistant/store";
import { BaseApprovalCard } from "./BaseApprovalCard";
import type { ApprovalAnswer } from "./BaseApprovalCard";

/**
 * How "Make this change" is offered: as the reply's next step, or inside a
 * lesson as a way out, since there the same click skips the hint ladder
 */
export type MakeChangeMode = "next" | "lastResort";

/**
 * The moves offered on a finished reply. Each is present only on the reply
 * that offers it; the thread decides which reply that is. A lesson offers
 * Build/Deploy and Skip one at a time, never together.
 */
export type ReplyActions = {
  /**
   * Asks the assistant to turn what it just described into a patch, which
   * still arrives as an approval card
   */
  makeChange?: { onClick: () => void; mode: MakeChangeMode };
  /** Runs the action that can prove the current lesson step */
  verifyStep?: {
    onClick: () => void | Promise<unknown>;
    stage: "build" | "deploy";
    title: string;
  };
  /** The lesson's escape valve, recorded as a skip */
  skipStep?: { onClick: () => void; title: string };
  /**
   * On an error whose provider refused the key: reopens Connect a model on
   * that backend for the key to be entered again
   */
  enterKey?: () => void;
};

const MAKE_CHANGE: Record<
  MakeChangeMode,
  { label: string; title: string; variant: "outline" | "link" }
> = {
  next: {
    label: "Make this change",
    title: "Ask the assistant to write this change, for you to review",
    variant: "outline",
  },
  lastResort: {
    label: "Write it for me",
    title:
      "Skip the rest of the hints and have the assistant write it, for you to review",
    variant: "link",
  },
};

const VERIFY_LABEL = { build: "Build", deploy: "Deploy" } as const;

/** One item of the conversation, drawn from props only */
export const BaseThreadItem = ({
  item,
  actions,
  onAnswer,
}: {
  item: ChatItem;
  actions?: ReplyActions;
  onAnswer: (id: string, answer: ApprovalAnswer) => void;
}) => {
  switch (item.kind) {
    case "user":
      return (
        <Message align="end">
          <MessageContent>
            <Bubble variant="default" align="end">
              <BubbleContent className="whitespace-pre-wrap">
                {/* Alignment and colour say who spoke; a screen reader
                    reading the log needs it said */}
                <span className="sr-only">You: </span>
                {item.text}
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      );

    case "assistant":
      // Nothing streamed yet: the thread's working marker stands in
      if (!item.text) return null;
      return (
        <Message>
          <MessageContent>
            <Bubble variant="ghost" className="w-full">
              <BubbleContent className="w-full">
                <span className="sr-only">Assistant: </span>
                <Markdown codeFontOnly>{item.text}</Markdown>
              </BubbleContent>
            </Bubble>
            {actions && <ReplyFooter actions={actions} />}
          </MessageContent>
        </Message>
      );

    case "tool":
      return (
        <Marker>
          <MarkerIcon>
            <CheckIcon className="text-success" />
          </MarkerIcon>
          <MarkerContent>{item.label}</MarkerContent>
        </Marker>
      );

    case "error":
      return (
        <Callout variant="error" role="alert">
          <CalloutDescription className="break-words">
            {item.text}
          </CalloutDescription>
          {actions?.enterKey && (
            // Spec 08 (state AI-05) offers Open settings and Use hosted model;
            // the key lives in Connect a model here, so Enter key opens that.
            // TODO(HOO-1719): its look awaits Design alignment's sync item
            // 4.15; the design system's outline button until then
            <Button
              id="assistant-enter-key"
              variant="outline"
              size="sm"
              className="mt-2 self-start"
              onClick={actions.enterKey}
            >
              Enter key
            </Button>
          )}
        </Callout>
      );

    case "notice":
      return (
        <Callout role="status">
          <CalloutDescription>{item.text}</CalloutDescription>
        </Callout>
      );

    case "approval":
      return (
        <BaseApprovalCard
          item={item}
          onAnswer={(answer) => onAnswer(item.id, answer)}
        />
      );
  }
};

const ReplyFooter = ({ actions }: { actions: ReplyActions }) => {
  const { makeChange, verifyStep, skipStep } = actions;
  if (!makeChange && !verifyStep && !skipStep) return null;
  const change = makeChange && MAKE_CHANGE[makeChange.mode];

  return (
    <MessageFooter className="flex-wrap gap-2 px-0">
      {makeChange && change && (
        <Button
          size="sm"
          variant={change.variant}
          title={change.title}
          onClick={makeChange.onClick}
        >
          {change.label}
        </Button>
      )}
      {verifyStep && (
        <AsyncButton
          size="sm"
          title={verifyStep.title}
          onClick={verifyStep.onClick}
          onError={reportButtonFailure("check the step")}
        >
          {VERIFY_LABEL[verifyStep.stage]}
        </AsyncButton>
      )}
      {skipStep && (
        <Button
          size="sm"
          variant="link"
          title={skipStep.title}
          onClick={() => {
            // A plain button has no `onError`; a throw from the lesson would
            // otherwise reach no logger
            try {
              skipStep.onClick();
            } catch (error) {
              reportButtonFailure("skip the step")(error);
            }
          }}
        >
          Skip this step
        </Button>
      )}
    </MessageFooter>
  );
};
