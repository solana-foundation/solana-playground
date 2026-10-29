import { CirclePlayIcon } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { Marker, MarkerIcon } from "@/shared/ui/marker";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/shared/ui/message-scroller";
import { Spinner } from "@/shared/ui/spinner";
import { THREAD_NOT_SAVED } from "../../../views/sidebar/assistant/store";
import type { ChatItem } from "../../../views/sidebar/assistant/store";
import { BaseThreadItem } from "./BaseThreadItem";
import type { ReplyActions } from "./BaseThreadItem";
import type { ApprovalAnswer } from "./BaseApprovalCard";
import type { SignInOffer } from "../model/sign-in-offer";

/**
 * The conversation, drawn from props only.
 *
 * The scroller follows new content while the reader is at the end and stays
 * put once they scroll up by wheel, touch or keys, offering "Scroll to end"
 * instead. The log "Conversation" is the scroller's content; there is no
 * scroll anchor, so a send made while scrolled up does not move the thread.
 */
export const BaseThread = ({
  items,
  working,
  unsaved,
  signIn,
  project,
  suggestions,
  onSuggestion,
  actionsFor,
  onAnswer,
}: {
  items: readonly ChatItem[];
  /** The turn is running and the last item is not a reply with text: before the first token and while tools run */
  working: boolean;
  /** The open thread could not be read, so nothing typed into it is saved */
  unsaved: boolean;
  /** The line a signed-out thread ends in, or `null` when it is not shown */
  signIn: SignInOffer | null;
  /** The open project's name, or `null` when there is none */
  project: string | null;
  suggestions: readonly string[];
  onSuggestion: (text: string) => void;
  /** The moves offered on a reply, for the one reply that offers them */
  actionsFor: (id: string) => ReplyActions | undefined;
  onAnswer: (id: string, answer: ApprovalAnswer) => void;
}) => (
  <MessageScrollerProvider autoScroll>
    <MessageScroller className="flex-1">
      <MessageScrollerViewport>
        <MessageScrollerContent
          aria-label="Conversation"
          className="gap-4 px-3 py-4"
        >
          {unsaved && (
            <Callout role="status">
              <CalloutDescription>{THREAD_NOT_SAVED}</CalloutDescription>
            </Callout>
          )}
          {items.length === 0 ? (
            <EmptyThread
              project={project}
              suggestions={suggestions}
              onSuggestion={onSuggestion}
            />
          ) : (
            items.map((item) => (
              <MessageScrollerItem key={item.id} messageId={item.id}>
                <BaseThreadItem
                  item={item}
                  actions={actionsFor(item.id)}
                  onAnswer={onAnswer}
                />
              </MessageScrollerItem>
            ))
          )}
          {signIn && (
            <Callout role="status">
              <CalloutDescription>
                Sign in to keep this conversation on your other devices.
              </CalloutDescription>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 justify-self-start"
                disabled={signIn.pending}
                onClick={signIn.onSignIn}
              >
                Sign in with GitHub
              </Button>
            </Callout>
          )}
          {working && (
            <Marker role="status" aria-label="Assistant is working">
              <MarkerIcon>
                <Spinner />
              </MarkerIcon>
            </Marker>
          )}
        </MessageScrollerContent>
      </MessageScrollerViewport>
      <MessageScrollerButton />
    </MessageScroller>
  </MessageScrollerProvider>
);

const EmptyThread = ({
  project,
  suggestions,
  onSuggestion,
}: {
  project: string | null;
  suggestions: readonly string[];
  onSuggestion: (text: string) => void;
}) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
    <CirclePlayIcon
      className="mb-2 size-10 text-primary drop-shadow-[0_0_18px_color-mix(in_oklch,var(--primary)_40%,transparent)]"
      aria-hidden
    />
    {/* Under the panel head, which is the h2; the prototype's display type */}
    <h3 className="max-w-[16em] font-heading text-[clamp(1.375rem,1.9vw,1.75rem)] leading-[1.12] font-medium tracking-[-0.015em] text-foreground">
      {project ? `Ask about ${project}` : "Ask the assistant"}
    </h3>
    <p className="max-w-[21rem] text-sm leading-normal text-muted-foreground">
      It reads the file you are looking at and the last build error, and
      proposes patches you apply yourself.
    </p>
    {/* A row that wraps, as the prototype lays the questions out */}
    <div className="flex flex-wrap justify-center gap-1.5 pt-3.5">
      {suggestions.map((suggestion) => (
        <Button
          key={suggestion}
          variant="outline"
          size="sm"
          className="h-auto rounded-full border-border bg-card px-3 py-1.5 text-[0.8125rem] font-normal text-muted-foreground dark:border-border dark:bg-card"
          onClick={() => onSuggestion(suggestion)}
        >
          {suggestion}
        </Button>
      ))}
    </div>
  </div>
);
