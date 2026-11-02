import { CirclePlayIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription, CalloutTitle } from "@/shared/ui/callout";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { Marker, MarkerContent, MarkerIcon } from "@/shared/ui/marker";
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

/** A message the model turned away for load, counting down to its next send */
export interface BusyRetryView {
  secondsLeft: number;
  /** Off while the server's own wait runs */
  canTryNow: boolean;
  onTryNow: () => Promise<void>;
  onStop: () => void;
}

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
  retry,
  undoFor = () => undefined,
  originalFor = () => undefined,
  isCutOff = () => false,
  retryFor = () => undefined,
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
  /** Spec 08's AI-03, under the message that waits; never a stored item */
  retry?: BusyRetryView;
  /** Takes back the patch of the card `id`, or `undefined` when it no longer can */
  undoFor?: (id: string) => (() => void) | undefined;
  /** The file before the patch of the card `id`, when its Undo could not finish */
  originalFor?: (id: string) => string | undefined;
  /** Whether a reply was cut off mid-stream */
  isCutOff?: (item: ChatItem) => boolean;
  /** Sends the last message again from the item `id`, or `undefined` where Try again is not offered */
  retryFor?: (id: string) => (() => void) | undefined;
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
                  onUndo={undoFor(item.id)}
                  original={originalFor(item.id)}
                  cutOff={isCutOff(item)}
                  onRetry={retryFor(item.id)}
                />
              </MessageScrollerItem>
            ))
          )}
          {retry && <BusyRetry retry={retry} />}
          {working && <Thinking />}
        </MessageScrollerContent>
      </MessageScrollerViewport>
      <MessageScrollerButton />
    </MessageScroller>
  </MessageScrollerProvider>
);

const BusyRetry = ({ retry }: { retry: BusyRetryView }) => (
  <Callout variant="warning">
    <CalloutTitle>The model is busy</CalloutTitle>
    <CalloutDescription>
      Trying again in {retry.secondsLeft} s.
    </CalloutDescription>
    <div className="flex gap-2">
      <AsyncButton
        size="sm"
        disabled={!retry.canTryNow}
        onClick={retry.onTryNow}
        onError={reportButtonFailure("send your message again")}
      >
        Try now
      </AsyncButton>
      <Button size="sm" variant="ghost" onClick={retry.onStop}>
        Stop
      </Button>
    </div>
  </Callout>
);

/**
 * While `working` (a turn runs and its last item is not a reply with text:
 * before the first text, and while a tool runs after one): "Thinking", then
 * the seconds since the marker appeared. Announced once, by its name: the
 * count is hidden from screen readers, which would otherwise read it every
 * second, and the spinner stands still under reduced motion.
 */
const Thinking = () => {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - start) / 1000)),
      1000
    );
    return () => clearInterval(timer);
  }, []);

  return (
    <Marker role="status" aria-label="Assistant is working">
      <MarkerIcon>
        <Spinner
          role="presentation"
          aria-hidden="true"
          className="motion-reduce:animate-none"
        />
      </MarkerIcon>
      <MarkerContent>
        Thinking
        {seconds > 0 && (
          <span aria-hidden="true" className="ml-1.5 tabular-nums">
            {seconds}s
          </span>
        )}
      </MarkerContent>
    </Marker>
  );
};

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
