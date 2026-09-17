import { useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";

import ChatItem from "./ChatItem";
import Connect from "./Connect";
import Button from "../../../../components/Button";
import { ThreeDots } from "../../../../components/Loading/ThreeDots";
import {
  PgAssistant,
  turnAppliedApproval,
  turnProducedApproval,
} from "../store";
import { PgBuildOutput } from "../bridge/build-output";
import { describeLesson } from "../bridge/lesson-context";
import { realBridge } from "../bridge/playground-bridge";
import { createProvider } from "../model";
import { PgChatSync } from "../../../../features/persistence/model/chat-sync";
import { toReplayMessages } from "../../../../features/persistence/model/replay";
import { PgCommand, PgExplorer, PgProgramInfo } from "../../../../utils";
import { useRenderOnChange } from "../../../../hooks";
import {
  currentStep,
  INITIAL_LESSON_STATE,
  PgLesson,
  verifyingStage,
} from "../../../flow/lessons";
import type { LessonState } from "../../../flow/lessons";
import type { Connection } from "../store";
import type { Provider } from "../model/types";

const SUGGESTIONS = [
  "Why did my build fail?",
  "What does this program do?",
  "What's our current status and roadmap?",
];

/**
 * Sent by "Make this change": models often describe an edit in prose instead of
 * calling `write_file`. This asks for the same edit as a patch, which lands in
 * the usual approval card.
 *
 * Phrased to work mid-lesson too, where the assistant is holding back a hint
 * and has described no edit yet — and leaving it a line to say afterwards, so
 * the turn does not end on a silence the panel has to explain.
 */
const MAKE_CHANGE =
  "Write this change for me, using write_file with the complete new content " +
  "of the file — the change you just described, or the one this step needs " +
  "if you have not described one yet. If it touches more than one file, do " +
  "them one at a time. Skip the explanation you would usually give first and " +
  "summarise it in one line afterwards.";

const Chat = () => {
  useRenderOnChange(PgAssistant.onDidChange);

  const [input, setInput] = useState("");
  const provider = useRef<{
    connection: Connection;
    instance: Provider;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const turn = useRef<AbortController | null>(null);
  // Bridges `onDidRequestPrompt`, which must subscribe unconditionally, to
  // `send`, which only exists once a backend is connected below
  const sendRef = useRef<(text: string) => void>(() => {});

  // "Fix with assistant" and similar callers outside the panel ask for a
  // prompt to be sent through `PgAssistant.requestPrompt`; this is the only
  // place that turns the request into an actual send
  useEffect(() => {
    return PgAssistant.onDidRequestPrompt(
      ({ text, send }) => {
        if (!PgAssistant.isConnected) {
          setInput(text);
          PgAssistant.addNotice(
            "Connect a backend to send this to the assistant."
          );
          return;
        }
        // A prompt the user did not type gets one look before it costs a turn
        if (!send) {
          setInput(text);
          inputRef.current?.focus();
          return;
        }
        sendRef.current(text);
      },
      { sends: true }
    ).dispose;
  }, []);

  const items = PgAssistant.items;
  const status = PgAssistant.status;
  // A stopped turn still has to unwind, and `cancelPending` drops the status to
  // idle before it does; the controller is what says a turn is really over
  const busy = status !== "idle" || !!turn.current;

  // Follow the conversation as it grows
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [items.length, status]);

  // The textarea is disabled during a turn, which drops focus; hand it back
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  const [lessonState, setLessonState] =
    useState<LessonState>(INITIAL_LESSON_STATE);
  useEffect(() => PgLesson.onDidChange(setLessonState).dispose, []);

  const connection = PgAssistant.connection;
  if (!connection || PgAssistant.isPickingBackend) {
    // The conversation is restored long before a backend is picked -- on
    // another browser, picking one is the first thing the user does, and
    // returning only the picker made a thread that was already in memory look
    // like it had not been synced at all. Shown read-only: every action a
    // `ChatItem` offers starts a turn, and there is nothing to run it.
    return (
      <Wrapper>
        {items.length > 0 && (
          <Messages role="log" aria-label="Conversation">
            {items.map((item) => (
              <ChatItem key={item.id} item={item} />
            ))}
            <div ref={bottomRef} />
          </Messages>
        )}

        <ConnectSlot>
          <Connect />
        </ConnectSlot>
      </Wrapper>
    );
  }

  // One provider per connection; it owns the conversation history. The store
  // keeps the same object while the settings are unchanged, so identity is
  // enough to catch a switched key or model as well as a switched provider.
  if (provider.current?.connection !== connection) {
    provider.current = {
      connection,
      // Seeded from what is rendered, so reopening a stored thread gives the
      // model the conversation rather than amnesia behind a full transcript
      instance: createProvider(connection, toReplayMessages(PgAssistant.items)),
    };
  }

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setInput("");
    PgAssistant.addUserMessage(trimmed);
    PgAssistant.setStatus("running");

    const controller = new AbortController();
    turn.current = controller;

    try {
      await provider.current!.instance.send(trimmed, controller.signal);
    } catch (e) {
      // Stopping is the user's own doing; `stop` already said so
      if (!controller.signal.aborted) {
        PgAssistant.addError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (turn.current === controller) turn.current = null;
      PgAssistant.setStatus("idle");

      // End of turn is the natural commit point: the exchange is complete and
      // the user is reading rather than typing. Deliberately not awaited --
      // a slow or failed upload must not hold up the panel, and the local
      // copy is already written either way.
      const threadId = PgAssistant.threadId;
      if (threadId) void PgChatSync.push(threadId);
    }
  };
  sendRef.current = send;

  /**
   * Aborting the request is not enough on its own: a tool waiting on an
   * approval holds the agent loop open, so deny whatever is pending too.
   */
  const stop = () => {
    if (!turn.current) return;
    turn.current.abort();
    PgAssistant.cancelPending();
    PgAssistant.addNotice("Stopped.");
  };

  // Mirror what `describeProject()` actually sends, so the row cannot claim
  // less than the model gets. Paths only — never file content, since this runs
  // on every render, including every streamed token.
  const currentFilePath = PgExplorer.currentFilePath;
  const filePaths = realBridge.listFiles();
  const openPaths = realBridge.listOpenFiles();
  const lesson = describeLesson(lessonState);
  const chips = [
    lesson
      ? {
          label: `step ${lesson.stepIndex} of ${lesson.stepCount}`,
          title: lesson.objective,
        }
      : null,
    {
      label: `${filePaths.length} ${filePaths.length === 1 ? "file" : "files"}`,
      title: `Every path is sent each turn, and the assistant can read any of them:\n\n${filePaths.join(
        "\n"
      )}`,
    },
    openPaths.length > 1
      ? {
          label: `${openPaths.length} open`,
          title: `Your open tabs are named each turn; only the active one is sent in full:\n\n${openPaths.join(
            "\n"
          )}`,
        }
      : null,
    currentFilePath
      ? {
          label: `${PgExplorer.getItemNameFromPath(currentFilePath)} active`,
          title: "The tab you are looking at, sent in full every turn",
        }
      : null,
    PgBuildOutput.latest?.failed
      ? { label: "build error", title: "The last build's compiler output" }
      : null,
    PgProgramInfo.idl
      ? { label: "idl", title: "The built program's interface" }
      : null,
  ].filter((chip): chip is { label: string; title: string } => !!chip);

  // Offer "Make this change" on the reply the assistant just finished, and
  // only there: an older message describes code that has since moved on, and a
  // turn ending in an approval card has already produced its patch.
  const lastItem = items[items.length - 1];
  const wroteThisTurn = turnProducedApproval(items);
  const changeableId =
    !busy && lastItem?.kind === "assistant" && lastItem.text && !wroteThisTurn
      ? lastItem.id
      : null;

  /**
   * The two mid-lesson actions on a finished reply, offered one at a time so
   * the reply always names the single next move:
   *
   * - the patch has landed but no build has run yet: the move is that build,
   *   which is also the only thing that can prove the step. This is the CTA
   *   the reply used to end on, except it pointed at the next step instead of
   *   at the action, so taking it skipped the step it was meant to finish.
   * - a build has run and the step is still unverified: the learner may be
   *   right and the grader wrong, so the escape valve appears. Nothing here
   *   proves anything, so it stays labelled as the skip it records.
   */
  const onFinishedReply = !busy && lesson && lastItem?.kind === "assistant";
  const step =
    lessonState.path && currentStep(lessonState.path, lessonState.progress);
  const stage = step && verifyingStage(step.verify);

  const verifiableId =
    onFinishedReply &&
    !lessonState.attempted &&
    stage &&
    turnAppliedApproval(items)
      ? lastItem.id
      : null;

  const skippableId =
    onFinishedReply && lessonState.attempted ? lastItem.id : null;

  // Cover the silent gaps: before the first token and while tools run.
  // Once text streams into the last assistant item the dots come down.
  const thinking =
    status === "running" && (lastItem?.kind !== "assistant" || !lastItem.text);

  return (
    <Wrapper>
      <BackendBar>
        <BackendLabel>{provider.current.instance.label}</BackendLabel>
        <ChangeBackend
          title={busy ? "Finish this turn first" : "Pick another backend"}
          disabled={busy}
          onClick={() => PgAssistant.pickBackend()}
        >
          Change
        </ChangeBackend>
      </BackendBar>

      <Messages role="log" aria-label="Conversation">
        {items.length === 0 ? (
          <Empty>
            <EmptyLabel>TRY ASKING</EmptyLabel>
            {SUGGESTIONS.map((suggestion) => (
              <Suggestion key={suggestion} onClick={() => send(suggestion)}>
                {suggestion}
              </Suggestion>
            ))}
          </Empty>
        ) : (
          items.map((item) => (
            <ChatItem
              key={item.id}
              item={item}
              onMakeChange={
                item.id === changeableId ? () => send(MAKE_CHANGE) : undefined
              }
              // Inside a lesson the same click skips the hint ladder, so it is
              // offered as a way out rather than as the obvious next step
              makeChangeIsLastResort={!!lesson}
              onVerifyStep={
                item.id === verifiableId
                  ? () => PgCommand[stage!].execute()
                  : undefined
              }
              verifyStepLabel={stage === "deploy" ? "Deploy" : "Build"}
              verifyStepTitle={
                lesson &&
                `${lesson.verifiedBy} — this is what proves it, and the only thing that can.`
              }
              onSkipStep={
                item.id === skippableId ? () => PgLesson.skipStep() : undefined
              }
              skipStepTitle={
                lesson &&
                `This step is still not verified — ${lesson.verifiedBy}. Skipping records that you moved past it unproven; you can come back with the arrows.`
              }
            />
          ))
        )}
        {thinking && (
          <Thinking role="status" aria-label="Assistant is working">
            <ThreeDots width="0.25rem" height="0.25rem" distance="0.5rem" />
          </Thinking>
        )}
        <div ref={bottomRef} />
      </Messages>

      <Composer>
        {chips.length > 0 && (
          <Context>
            <ContextLabel>CONTEXT</ContextLabel>
            {chips.map((chip) => (
              <Chip key={chip.label} title={chip.title}>
                {chip.label}
              </Chip>
            ))}
          </Context>
        )}

        <InputRow>
          <TextArea
            ref={inputRef}
            aria-label="Message the assistant"
            value={input}
            placeholder={
              status === "awaiting"
                ? "Waiting on your decision…"
                : busy
                ? "Working…"
                : "Ask about this project…"
            }
            disabled={busy}
            rows={2}
            onChange={(ev) => setInput(ev.target.value)}
            onKeyDown={(ev) => {
              // `isComposing` guards IME input — Enter there commits the
              // composition, it must not send the message
              if (
                ev.key === "Enter" &&
                !ev.shiftKey &&
                !ev.nativeEvent.isComposing
              ) {
                ev.preventDefault();
                send(input);
              }
            }}
          />
          {/**
           * Distinct keys: without them React reuses one `Button` instance for
           * both, and its internal loading state carries across the swap.
           */}
          {busy ? (
            <Button
              key="stop"
              kind="secondary"
              size="small"
              title="Stop this turn"
              onClick={stop}
            >
              Stop
            </Button>
          ) : (
            <Button
              key="send"
              kind="primary"
              size="small"
              disabled={!input.trim()}
              // Deliberately not returned: `Button` awaits its handler and
              // would sit disabled for the whole turn, Stop included
              onClick={() => {
                send(input);
              }}
            >
              Send
            </Button>
          )}
        </InputRow>

        <Footer>
          <span>nothing is written without your click</span>
        </Footer>
      </Composer>
    </Wrapper>
  );
};

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-height: 0;
`;

/**
 * Keeps the picker at its natural height under a restored conversation.
 *
 * Without it the two share the column and the picker is squeezed to whatever
 * the transcript leaves -- the transcript is the part that should scroll.
 */
const ConnectSlot = styled.div`
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-height: 0;
  overflow-y: auto;
`;

const Messages = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1.125rem;
  flex-grow: 1;
  overflow-y: auto;
  padding: 1rem 0.75rem;
  min-height: 0;
`;

const Empty = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const EmptyLabel = styled.div`
  ${({ theme }) => css`
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
    letter-spacing: 0.1em;
    padding-bottom: 0.25rem;
  `}
`;

const Suggestion = styled.button`
  ${({ theme }) => css`
    text-align: left;
    padding: 0.625rem 0.6875rem;
    background: transparent;
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    color: ${theme.colors.default.textSecondary};
    font: inherit;
    font-size: ${theme.font.code.size.small};
    line-height: 1.5;
    cursor: pointer;
    transition: all ${theme.default.transition.duration.medium}
      ${theme.default.transition.type};

    &:hover {
      background: ${theme.colors.state.hover.bg};
      color: ${theme.colors.default.textPrimary};
    }

    &:focus-visible {
      outline: 1px solid ${theme.colors.default.primary};
      outline-offset: -1px;
    }
  `}
`;

const Thinking = styled.div`
  /* The outer dots of \`ThreeDots\` are pseudo-elements offset by \`distance\`,
   * so the row needs its own room on the left */
  display: flex;
  align-items: center;
  min-height: 0.75rem;
  padding-left: 0.625rem;
`;

const Composer = styled.div`
  ${({ theme }) => css`
    flex-shrink: 0;
    border-top: 1px solid ${theme.colors.default.border};
    padding: 0.5rem 0.75rem 0.75rem;
    background: ${theme.colors.default.bgSecondary};

    /**
     * The sidebar sizes itself with \`calc(100vh - <bottom height>)\`, so if
     * anything above it drifts by a pixel the panel is taller than the space it
     * has and the composer lands below the fold. Sticking it to the bottom of
     * the scrollport keeps it reachable either way.
     */
    position: sticky;
    bottom: 0;
    z-index: 1;
  `}
`;

const Context = styled.div`
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex-wrap: wrap;
  padding-bottom: 0.5rem;
`;

const ContextLabel = styled.span`
  ${({ theme }) => css`
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
    letter-spacing: 0.08em;
  `}
`;

const Chip = styled.span`
  ${({ theme }) => css`
    padding: 0.0625rem 0.4375rem;
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
  `}
`;

const InputRow = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
`;

const TextArea = styled.textarea`
  ${({ theme }) => css`
    flex-grow: 1;
    resize: none;
    padding: 0.5rem 0.625rem;
    background: ${theme.colors.default.bgSecondary};
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    color: ${theme.colors.default.textPrimary};
    font: inherit;
    font-size: ${theme.font.code.size.small};

    &:focus {
      outline: 1px solid ${theme.colors.default.primary};
    }

    &:disabled {
      color: ${theme.colors.default.textSecondary};
      cursor: not-allowed;
    }
  `}
`;

const Footer = styled.div`
  ${({ theme }) => css`
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0 0.5rem;
    padding-top: 0.4375rem;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};

    & > span {
      white-space: nowrap;
    }
  `}
`;

const BackendBar = styled.div`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-shrink: 0;
    padding: 0.4375rem 0.75rem;
    border-bottom: 1px solid ${theme.colors.default.border};
    background: ${theme.colors.default.bgSecondary};
  `}
`;

const BackendLabel = styled.span`
  ${({ theme }) => css`
    overflow: hidden;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
    text-overflow: ellipsis;
    white-space: nowrap;
  `}
`;

const ChangeBackend = styled.button`
  ${({ theme }) => css`
    flex-shrink: 0;
    padding: 0.125rem 0.5rem;
    background: transparent;
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    color: ${theme.colors.default.textPrimary};
    font: inherit;
    font-size: ${theme.font.code.size.xsmall};
    cursor: pointer;
    transition: all ${theme.default.transition.duration.medium}
      ${theme.default.transition.type};

    &:hover:not(:disabled) {
      background: ${theme.colors.state.hover.bg};
      border-color: ${theme.colors.default.primary};
    }

    &:disabled {
      color: ${theme.colors.default.textSecondary};
      cursor: not-allowed;
    }

    &:focus-visible {
      outline: 1px solid ${theme.colors.default.primary};
      outline-offset: -1px;
    }
  `}
`;

export default Chat;
