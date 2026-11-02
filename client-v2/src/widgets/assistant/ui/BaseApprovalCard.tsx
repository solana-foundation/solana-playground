import { useMemo } from "react";

import { Badge } from "@/shared/ui/badge";
import { BrandButton } from "@/shared/ui/brand-button";
import { Button } from "@/shared/ui/button";
import {
  Diff,
  DiffContent,
  DiffFooter,
  DiffHeader,
  DiffLine,
  DiffStat,
  DiffTitle,
} from "@/shared/ui/diff";
import { cn } from "@/shared/lib/utils";
import {
  diffLines,
  summarizeDiff,
} from "../../../views/sidebar/assistant/diff";
import type {
  ApprovalStatus,
  ChatItem,
  PatchApproval,
} from "../../../views/sidebar/assistant/store";

export type ApprovalItem = Extract<ChatItem, { kind: "approval" }>;

/** How the user answered a card; the store takes it as `allowed` */
export type ApprovalAnswer = "allow" | "deny";

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "Proposed",
  allowed: "Applied",
  denied: "Declined",
  unanswered: "Not answered",
};

/** What a card no longer pending says when the tool reported no outcome of its own */
const OUTCOME: Record<Exclude<ApprovalStatus, "pending">, string> = {
  allowed: "done",
  denied: "not applied",
  unanswered: "not applied -- the session ended before you answered",
};

// The answers sit in one row of thumb-sized targets on a phone, where the
// card is most likely to end up half under the keyboard
const ANSWER = "h-11 md:h-8";

// A question is read whole, so it wraps instead of truncating
const QUESTION_TITLE = "font-sans text-sm whitespace-normal text-foreground";

/** The card's title: the command's question, else the file or command name */
const cardTitle = (request: ApprovalItem["request"]) => {
  if (request.type === "patch") return { text: request.path };
  if (request.question) {
    return { text: request.question, className: QUESTION_TITLE };
  }
  return { text: `wants to run ${request.name}` };
};

/**
 * A change or a command the assistant wants to make, with the user's answer.
 *
 * Draws only: `onAnswer` is called with the user's answer, and whether a card
 * is still open to an answer is its `status`, which the store owns.
 */
export const BaseApprovalCard = ({
  item,
  onAnswer,
}: {
  item: ApprovalItem;
  onAnswer: (answer: ApprovalAnswer) => void;
}) => {
  const { request, status } = item;
  const pending = status === "pending";
  const patch = request.type === "patch";
  const title = cardTitle(request);

  return (
    <Diff data-status={status} className={cn(pending && "border-primary")}>
      <DiffHeader>
        <DiffTitle className={title.className}>{title.text}</DiffTitle>
        {patch ? <PatchStat request={request} /> : <span className="ml-auto" />}
        <Badge
          variant={pending ? "default" : "outline"}
          className={cn(status === "allowed" && "text-success")}
        >
          {STATUS_LABEL[status]}
        </Badge>
      </DiffHeader>

      <DiffContent className="max-h-[min(15rem,40dvh)] overflow-auto">
        {patch ? (
          <PatchLines request={request} />
        ) : (
          // A pre holds phrasing content only, so its lines are block spans
          <span className="block px-3">
            <code className="block text-warning">$ {request.name}</code>
            <span className="block pt-1.5 font-sans text-xs whitespace-normal text-muted-foreground">
              {request.effect}
            </span>
          </span>
        )}
      </DiffContent>

      <DiffFooter>
        {pending ? (
          <>
            <BrandButton
              variant="accent"
              size="sm"
              className={cn("flex-1", ANSWER)}
              onClick={() => onAnswer("allow")}
            >
              {patch ? "Apply" : "Allow"}
            </BrandButton>
            <Button
              variant="outline"
              size="sm"
              className={ANSWER}
              onClick={() => onAnswer("deny")}
            >
              {patch ? "Reject" : "Deny"}
            </Button>
          </>
        ) : (
          <span
            className={cn(
              "text-xs",
              status === "allowed" ? "text-success" : "text-muted-foreground"
            )}
          >
            {item.outcome ?? OUTCOME[status]}
          </span>
        )}
      </DiffFooter>
    </Diff>
  );
};

const PatchStat = ({ request }: { request: PatchApproval }) => {
  const { added, removed } = useMemo(
    () => summarizeDiff(diffLines(request.before, request.after)),
    [request.before, request.after]
  );
  return <DiffStat added={added} removed={removed} />;
};

const PatchLines = ({ request }: { request: PatchApproval }) => {
  const lines = useMemo(
    () => diffLines(request.before, request.after),
    [request.before, request.after]
  );
  return (
    <>
      {lines.map((line, i) => (
        <DiffLine key={i} variant={line.kind}>
          {line.text || " "}
        </DiffLine>
      ))}
    </>
  );
};
