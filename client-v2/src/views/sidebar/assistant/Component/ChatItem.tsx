import { FC, useMemo } from "react";
import styled, { css } from "styled-components";

import Button from "../../../../components/Button";
import GradientButton from "../../../../components/GradientButton";
import Markdown from "../../../../components/Markdown";
import { diffLines, summarizeDiff } from "../diff";
import { PgAssistant, type ChatItem as Item } from "../store";
import { alpha } from "../../../../utils/theme/alpha";

const ChatItem: FC<
  React.PropsWithChildren<{
    item: Item;
    /**
     * Offered on the newest reply only: asks the assistant to turn what it just
     * described into a patch. The patch still arrives as an approval card, so
     * nothing is written on this click.
     */
    onMakeChange?: () => void;
    /** Render it as a quiet way out rather than the obvious next step */
    makeChangeIsLastResort?: boolean;
    /**
     * Runs the action that can prove the current lesson step — the move after a
     * patch lands, and the reply's main CTA when offered.
     */
    onVerifyStep?: () => void;
    verifyStepLabel?: string;
    verifyStepTitle?: string | false | null;
    /**
     * The mid-lesson escape valve, offered only once a build has already been
     * attempted on this step. Recorded as a skip — nothing in the chat proves a
     * step.
     */
    onSkipStep?: () => void;
    skipStepTitle?: string | false | null;
  }>
> = ({
  item,
  onMakeChange,
  makeChangeIsLastResort,
  onVerifyStep,
  verifyStepLabel,
  verifyStepTitle,
  onSkipStep,
  skipStepTitle,
}) => {
  switch (item.kind) {
    case "user":
      return (
        <Turn>
          <Role>YOU</Role>
          <UserText>{item.text}</UserText>
        </Turn>
      );

    case "assistant":
      // Nothing streamed yet -- the chat's thinking indicator stands in, so
      // don't render a role header with nothing under it
      if (!item.text) return null;
      return (
        <Turn>
          <Role $accent>ASSISTANT</Role>
          <Markdown codeFontOnly>{item.text}</Markdown>
          {onMakeChange && (
            <MakeChange
              $quiet={makeChangeIsLastResort}
              title={
                makeChangeIsLastResort
                  ? "Skip the rest of the hints and have the assistant write it, for you to review"
                  : "Ask the assistant to write this change, for you to review"
              }
              onClick={onMakeChange}
            >
              {makeChangeIsLastResort ? "Write it for me" : "Make this change"}
            </MakeChange>
          )}
          {onVerifyStep && (
            <VerifyStep
              kind="primary"
              size="small"
              title={verifyStepTitle || undefined}
              onClick={onVerifyStep}
            >
              {verifyStepLabel}
            </VerifyStep>
          )}
          {onSkipStep && (
            <MakeChange
              $quiet
              title={skipStepTitle || undefined}
              onClick={onSkipStep}
            >
              Skip this step
            </MakeChange>
          )}
        </Turn>
      );

    case "tool":
      return (
        <ToolLine>
          <Tick viewBox="0 0 12 12" width="12" height="12" aria-hidden>
            <path
              d="M2.5 6.3l2.4 2.4 4.6-5.4"
              fill="none"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Tick>
          {item.label}
        </ToolLine>
      );

    case "error":
      return <ErrorBox role="alert">{item.text}</ErrorBox>;

    case "notice":
      return <Notice role="status">{item.text}</Notice>;

    case "approval":
      return <Approval item={item} />;
  }
};

const Approval: FC<
  React.PropsWithChildren<{ item: Extract<Item, { kind: "approval" }> }>
> = ({ item }) => {
  const { request, status } = item;
  const pending = status === "pending";

  // The shared Button restores its own state after awaiting onClick; resolving
  // synchronously unmounts the pending actions row under it. Defer a tick.
  const allow = () =>
    setTimeout(() => PgAssistant.resolveApproval(item.id, true), 0);
  const deny = () =>
    setTimeout(() => PgAssistant.resolveApproval(item.id, false), 0);

  const label =
    status === "allowed"
      ? "APPLIED"
      : status === "denied"
      ? "DECLINED"
      : status === "unanswered"
      ? "NOT ANSWERED"
      : null;

  return (
    <Card $pending={pending}>
      <CardHead>
        {request.type === "patch" ? (
          <PatchTitle request={request} />
        ) : (
          <CardTitle>wants to run {request.name}</CardTitle>
        )}
        <StatusLabel $status={status}>{label ?? "PROPOSED"}</StatusLabel>
      </CardHead>

      {request.type === "patch" ? (
        <Diff before={request.before} after={request.after} />
      ) : (
        <CommandBody>
          <Command>$ {request.name}</Command>
          <Effect>{request.effect}</Effect>
        </CommandBody>
      )}

      {pending ? (
        <Actions>
          <GradientButton kind="primary" size="small" fullWidth onClick={allow}>
            {request.type === "patch" ? "Apply" : "Allow"}
          </GradientButton>
          <Button kind="outline" size="small" onClick={deny}>
            {request.type === "patch" ? "Reject" : "Deny"}
          </Button>
        </Actions>
      ) : (
        <Outcome $allowed={status === "allowed"}>
          {item.outcome ??
            (status === "allowed"
              ? "done"
              : status === "unanswered"
              ? "not applied -- the session ended before you answered"
              : "not applied")}
        </Outcome>
      )}
    </Card>
  );
};

const PatchTitle: FC<
  React.PropsWithChildren<{
    request: Extract<Item, { kind: "approval" }>["request"] & { type: "patch" };
  }>
> = ({ request }) => {
  const { added, removed } = useMemo(
    () => summarizeDiff(diffLines(request.before, request.after)),
    [request.before, request.after]
  );

  return (
    <CardTitle>
      {request.path}
      <Counts>
        <Added>+{added}</Added>
        <Removed>-{removed}</Removed>
      </Counts>
    </CardTitle>
  );
};

const Diff: FC<
  React.PropsWithChildren<{ before: string | null; after: string }>
> = ({ before, after }) => {
  const lines = useMemo(() => diffLines(before, after), [before, after]);

  return (
    <DiffBody>
      {lines.map((line, i) => (
        <DiffRow key={i} $kind={line.kind}>
          <Gutter>{line.number ?? ""}</Gutter>
          <Sign $kind={line.kind}>
            {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
          </Sign>
          <Code>{line.text || " "}</Code>
        </DiffRow>
      ))}
    </DiffBody>
  );
};

const Turn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
`;

const Role = styled.div<{ $accent?: boolean }>`
  ${({ theme, $accent }) => css`
    color: ${$accent
      ? theme.colors.default.primary
      : theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
    letter-spacing: 0.1em;
  `}
`;

const UserText = styled.div`
  ${({ theme }) => css`
    color: ${theme.colors.default.textPrimary};
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  `}
`;

const ToolLine = styled.div`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.small};
  `}
`;

const Tick = styled.svg`
  ${({ theme }) => css`
    flex-shrink: 0;
    stroke: ${theme.colors.state.success.color};
  `}
`;

// Left-aligned with the reply's own text rather than stretched, so it reads as
// this message's next move and not as the panel's
const VerifyStep = styled(Button)`
  align-self: flex-start;
  margin-top: 0.5rem;
`;

const MakeChange = styled.button<{ $quiet?: boolean }>`
  ${({ theme, $quiet }) => css`
    align-self: flex-start;
    margin-top: 0.5rem;
    padding: 0.1875rem 0.5rem;
    background: transparent;
    border: 1px solid ${$quiet ? "transparent" : theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    color: ${$quiet
      ? theme.colors.default.textSecondary
      : theme.colors.default.textPrimary};
    font: inherit;
    font-size: ${theme.font.code.size.xsmall};
    text-decoration: ${$quiet ? "underline" : "none"};
    cursor: pointer;
    transition: background ${theme.default.transition.duration.medium}
        ${theme.default.transition.type},
      border-color ${theme.default.transition.duration.medium}
        ${theme.default.transition.type};

    &:hover {
      background: ${theme.colors.state.hover.bg};
      border-color: ${theme.colors.default.primary};
    }

    &:focus-visible {
      outline: 1px solid ${theme.colors.default.primary};
      outline-offset: -1px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `}
`;

const Notice = styled.div`
  ${({ theme }) => css`
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
    font-style: italic;
  `}
`;

const ErrorBox = styled.div`
  ${({ theme }) => css`
    padding: 0.625rem 0.6875rem;
    border: 1px solid ${theme.colors.state.error.color};
    border-radius: ${theme.default.borderRadius};
    color: ${theme.colors.state.error.color};
    font-size: ${theme.font.code.size.small};
    line-height: 1.55;
    word-break: break-word;
  `}
`;

const Card = styled.div<{ $pending: boolean }>`
  ${({ theme, $pending }) => css`
    border: 1px solid
      ${$pending ? theme.colors.default.primary : theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    background: ${theme.colors.default.bgSecondary};
    overflow: hidden;
    /*
     * Messages (Chat.tsx) is a flex column that scrolls, and every other
     * item in it leaves overflow visible, so its content height is also
     * its flex-shrink floor. This card is the one item that sets its own
     * overflow: hidden, which per the flexbox spec drops its automatic
     * minimum size to 0 -- with a full conversation above it, flex-shrink
     * then crushes just this card down to a sliver (title visible, diff
     * and Apply/Reject clipped away) to keep Messages from overflowing.
     * flex-shrink: 0 opts it back out, so it renders at content height and
     * the list scrolls instead, same as every other item.
     */
    flex-shrink: 0;
  `}
`;

const CardHead = styled.div`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.625rem;
    border-bottom: 1px solid ${theme.colors.default.border};
  `}
`;

const CardTitle = styled.div`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.small};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `}
`;

const Counts = styled.span`
  display: flex;
  gap: 0.375rem;
  flex-shrink: 0;
`;

const Added = styled.span`
  ${({ theme }) => css`
    color: ${theme.colors.state.success.color};
    font-size: ${theme.font.code.size.xsmall};
  `}
`;

const Removed = styled.span`
  ${({ theme }) => css`
    color: ${theme.colors.state.error.color};
    font-size: ${theme.font.code.size.xsmall};
  `}
`;

const StatusLabel = styled.span<{ $status: string }>`
  ${({ theme, $status }) => css`
    flex-shrink: 0;
    font-size: ${theme.font.code.size.xsmall};
    letter-spacing: 0.08em;
    color: ${$status === "allowed"
      ? theme.colors.state.success.color
      : $status === "pending"
      ? theme.colors.default.primary
      : theme.colors.default.textSecondary};
  `}
`;

const DiffBody = styled.div`
  ${({ theme }) => css`
    padding: 0.375rem 0;
    font-size: ${theme.font.code.size.small};
    /* A large patch scrolls inside its card instead of flooding the chat */
    max-height: 15rem;
    overflow: auto;
  `}
`;

const DiffRow = styled.div<{ $kind: string }>`
  ${({ theme, $kind }) => css`
    display: flex;
    line-height: 1.6;
    background: ${$kind === "added"
      ? alpha(theme.colors.state.success.color, "low")
      : $kind === "removed"
      ? alpha(theme.colors.state.error.color, "low")
      : "transparent"};
  `}
`;

const Gutter = styled.span`
  ${({ theme }) => css`
    width: 2.25rem;
    flex-shrink: 0;
    padding-right: 0.5rem;
    text-align: right;
    color: ${theme.colors.default.textSecondary};
    opacity: 0.7;
  `}
`;

const Sign = styled.span<{ $kind: string }>`
  ${({ theme, $kind }) => css`
    width: 0.75rem;
    flex-shrink: 0;
    color: ${$kind === "added"
      ? theme.colors.state.success.color
      : $kind === "removed"
      ? theme.colors.state.error.color
      : theme.colors.default.textSecondary};
  `}
`;

const Code = styled.span`
  ${({ theme }) => css`
    color: ${theme.colors.default.textPrimary};
    white-space: pre;
  `}
`;

const CommandBody = styled.div`
  padding: 0.625rem 0.6875rem;
`;

const Command = styled.div`
  ${({ theme }) => css`
    color: ${theme.colors.state.warning.color};
    font-size: ${theme.font.code.size.small};
  `}
`;

const Effect = styled.div`
  ${({ theme }) => css`
    padding-top: 0.375rem;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
    line-height: 1.55;
  `}
`;

const Actions = styled.div`
  ${({ theme }) => css`
    display: flex;
    gap: 0.5rem;
    padding: 0.625rem;
    border-top: 1px solid ${theme.colors.default.border};
  `}
`;

const Outcome = styled.div<{ $allowed: boolean }>`
  ${({ theme, $allowed }) => css`
    padding: 0.625rem;
    border-top: 1px solid ${theme.colors.default.border};
    color: ${$allowed
      ? theme.colors.state.success.color
      : theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
  `}
`;

export default ChatItem;
