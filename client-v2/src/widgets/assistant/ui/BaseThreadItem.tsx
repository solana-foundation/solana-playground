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

/**
 * The moves offered on a finished reply. Each is present only on the reply
 * that offers it; the thread decides which reply that is.
 */
export type ReplyActions = {
  /**
   * Asks the assistant to turn what it just described into a patch, which
   * still arrives as an approval card. `lastResort` inside a lesson, where
   * the same click skips the hint ladder.
   */
  makeChange?: { onClick: () => void; lastResort: boolean };
  /** Runs the action that can prove the current lesson step */
  verifyStep?: {
    onClick: () => void | Promise<unknown>;
    label: string;
    title?: string;
  };
  /** The lesson's escape valve, recorded as a skip */
  skipStep?: { onClick: () => void; title?: string };
};

const MAKE_CHANGE_TITLE = {
  next: "Ask the assistant to write this change, for you to review",
  lastResort:
    "Skip the rest of the hints and have the assistant write it, for you to review",
};

/** One item of the conversation, drawn from props only */
export const BaseThreadItem = ({
  item,
  actions,
  onAnswer,
}: {
  item: ChatItem;
  actions?: ReplyActions;
  onAnswer?: (id: string, allowed: boolean) => void;
}) => {
  switch (item.kind) {
    case "user":
      return (
        <Message align="end">
          <MessageContent>
            <Bubble variant="default" align="end">
              <BubbleContent className="whitespace-pre-wrap">
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
          onAnswer={(allowed) => onAnswer?.(item.id, allowed)}
        />
      );
  }
};

const ReplyFooter = ({ actions }: { actions: ReplyActions }) => {
  const { makeChange, verifyStep, skipStep } = actions;
  if (!makeChange && !verifyStep && !skipStep) return null;

  return (
    <MessageFooter className="flex-wrap gap-2 px-0">
      {makeChange && (
        <Button
          size="sm"
          variant={makeChange.lastResort ? "link" : "outline"}
          title={
            makeChange.lastResort
              ? MAKE_CHANGE_TITLE.lastResort
              : MAKE_CHANGE_TITLE.next
          }
          onClick={makeChange.onClick}
        >
          {makeChange.lastResort ? "Write it for me" : "Make this change"}
        </Button>
      )}
      {verifyStep && (
        <AsyncButton
          size="sm"
          title={verifyStep.title}
          onClick={verifyStep.onClick}
          onError={reportButtonFailure}
        >
          {verifyStep.label}
        </AsyncButton>
      )}
      {skipStep && (
        <Button
          size="sm"
          variant="link"
          title={skipStep.title}
          onClick={skipStep.onClick}
        >
          Skip this step
        </Button>
      )}
    </MessageFooter>
  );
};
