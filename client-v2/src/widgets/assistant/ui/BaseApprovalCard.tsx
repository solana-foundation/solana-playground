import { useMemo } from "react";

import { Badge } from "@/shared/ui/badge";
import { BrandButton } from "@/shared/ui/brand-button";
import { Button } from "@/shared/ui/button";
import { CopyButton } from "@/shared/ui/copy-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
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
import { isUndoStranded } from "../../../views/sidebar/assistant/store";
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

/** An undo that did not finish is a warning; a patch still applied, a success */
const outcomeTone = (
  status: ApprovalStatus,
  undone: boolean,
  stranded: boolean
) => {
  if (stranded) return "text-warning";
  if (status === "allowed" && !undone) return "text-success";
  return "text-muted-foreground";
};

// The answers sit in one row of thumb-sized targets on a phone, where the
// card is most likely to end up half under the keyboard
const ANSWER = "h-11 md:h-8";

/**
 * A change or a command the assistant wants to make, with the user's answer.
 *
 * Draws only: `onAnswer` is called with the user's answer, and whether a card
 * is still open to an answer is its `status`, which the store owns. An
 * applied patch offers Undo patch only when the caller passes `onUndo`, which
 * it does while the patch can still be taken back.
 */
export const BaseApprovalCard = ({
  item,
  onAnswer,
  onUndo,
  original,
}: {
  item: ApprovalItem;
  onAnswer: (answer: ApprovalAnswer) => void;
  onUndo?: () => void;
  /** The file before the patch, offered to copy when Undo could not finish */
  original?: string;
}) => {
  const { request, status } = item;
  const pending = status === "pending";
  const patch = request.type === "patch";
  const undone = !!item.undone;
  const stranded = isUndoStranded(item.outcome);

  return (
    <Diff data-status={status} className={cn(pending && "border-primary")}>
      <DiffHeader>
        <DiffTitle>
          {patch ? request.path : `wants to run ${request.name}`}
        </DiffTitle>
        {patch ? <PatchStat request={request} /> : <span className="ml-auto" />}
        <Badge
          variant={pending ? "default" : "outline"}
          className={cn(status === "allowed" && !undone && "text-success")}
        >
          {undone ? "Undone" : STATUS_LABEL[status]}
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
          <>
            <span
              className={cn("text-xs", outcomeTone(status, undone, stranded))}
            >
              {item.outcome ?? OUTCOME[status]}
            </span>
            {original !== undefined && (
              <CopyButton
                value={original}
                label="Copy the original"
                className="ml-auto size-11 md:size-8"
                onError={reportButtonFailure("copy the original")}
              />
            )}
            {onUndo && (
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "min-w-11 md:min-w-0",
                  original === undefined && "ml-auto",
                  ANSWER
                )}
                onClick={onUndo}
              >
                Undo patch
              </Button>
            )}
          </>
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
