import { CirclePlayIcon } from "lucide-react";
import { useEffect, useRef } from "react";

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
  useMessageScroller,
} from "@/shared/ui/message-scroller";
import { Spinner } from "@/shared/ui/spinner";
import { THREAD_NOT_SAVED } from "../../../views/sidebar/assistant/store";
import type { ChatItem } from "../../../views/sidebar/assistant/store";
import { BaseThreadItem } from "./BaseThreadItem";
import type { ReplyActions } from "./BaseThreadItem";
import type { ApprovalAnswer } from "./BaseApprovalCard";

/**
 * The conversation, drawn from props only.
 *
 * The scroller follows new content while the reader is at the end and stays
 * put once they scroll up by wheel, touch or keys, offering "Scroll to end"
 * instead. The log "Conversation" is the scroller's content. Sending takes
 * the thread back to the end (`FollowOnSend`), so the reply is followed even
 * when the user sent it while scrolled up.
 */
export const BaseThread = ({
  items,
  working,
  unsaved,
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
  /** The open project's name, or `null` when there is none */
  project: string | null;
  suggestions: readonly string[];
  onSuggestion: (text: string) => void;
  /** The moves offered on a reply, for the one reply that offers them */
  actionsFor: (id: string) => ReplyActions | undefined;
  onAnswer: (id: string, answer: ApprovalAnswer) => void;
}) => (
  <MessageScrollerProvider autoScroll>
    <FollowOnSend items={items} working={working} />
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

/**
 * Scrolls to the end when the user sends: a new last user message that comes
 * with a turn starting (`working`, set in the same tick by `useTurn`'s send).
 * Without it a reader who had scrolled up stayed in free scrolling and the
 * reply streamed off-screen; `scrollToEnd` under `autoScroll` turns following
 * back on. A user message that arrives with no turn here, folded in from
 * another device or in another thread, leaves the reader where they are.
 */
const FollowOnSend = ({
  items,
  working,
}: {
  items: readonly ChatItem[];
  working: boolean;
}) => {
  const { scrollToEnd } = useMessageScroller();
  const lastSent = items.findLast((item) => item.kind === "user")?.id;
  const seen = useRef(lastSent);
  useEffect(() => {
    if (lastSent === seen.current) return;
    seen.current = lastSent;
    if (lastSent && working) scrollToEnd({ behavior: "auto" });
  }, [lastSent, working, scrollToEnd]);
  return null;
};

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
    {/* Under the panel head, which is the h2 */}
    <h3 className="text-xl font-semibold text-foreground">
      {project ? `Ask about ${project}` : "Ask the assistant"}
    </h3>
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
          className="h-auto rounded-full border-border bg-card px-3 py-1.5 text-[0.8125rem] font-normal text-muted-foreground dark:border-border dark:bg-card"
          onClick={() => onSuggestion(suggestion)}
        >
          {suggestion}
        </Button>
      ))}
    </div>
  </div>
);
