import { CirclePlayIcon } from "lucide-react";

import { Button } from "@/shared/ui/button";
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
import type { ChatItem } from "../../../views/sidebar/assistant/store";
import { BaseThreadItem } from "./BaseThreadItem";
import type { ReplyActions } from "./BaseThreadItem";
import type { ApprovalAnswer } from "./BaseApprovalCard";

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
  project,
  suggestions,
  onSuggestion,
  actionsFor,
  onAnswer,
}: {
  items: readonly ChatItem[];
  /** The turn is running and the last item is not a reply with text: before the first token and while tools run */
  working: boolean;
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
    <CirclePlayIcon className="size-12 text-primary" aria-hidden />
    <h2 className="text-xl font-semibold text-foreground">
      {project ? `Ask about ${project}` : "Ask the assistant"}
    </h2>
    <p className="max-w-xs text-sm text-muted-foreground">
      It reads the file you are looking at and the last build error, and
      proposes patches you apply yourself.
    </p>
    <div className="flex flex-col items-center gap-2 pt-2">
      {suggestions.map((suggestion) => (
        <Button
          key={suggestion}
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => onSuggestion(suggestion)}
        >
          {suggestion}
        </Button>
      ))}
    </div>
  </div>
);
