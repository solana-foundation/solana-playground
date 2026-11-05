import type { Proposal } from "@/features/tutorial-conversation";
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

export interface BaseApplyCardProps {
  proposal: Proposal;
  onApply: () => void;
  onKeep: () => void;
}

const baseName = (path: string) => path.split("/").pop() ?? path;

/** Why the last Apply did not land, said on the open card */
const FAILED: Record<NonNullable<Proposal["applyFailed"]>, string> = {
  moved:
    "Could not apply it: the line changed since. Ask again for a fresh change.",
  gone: "Could not apply it: the file is not there any more. Press Keep it to close this, or ask for a change to another file.",
  write:
    "Could not write the file. Try Apply again, or make the change yourself.",
};

/** How a settled card ends, in place of its buttons */
const SETTLED: Record<"applied" | "kept", string> = {
  applied: "Applied.",
  kept: "Kept yours.",
};

/**
 * A change the live assistant proposed: the line's diff and two outline
 * buttons, "Apply to <file>" and "Keep it". It never applies by itself
 * (spec "One composer; free questions go to the live assistant"). An Apply
 * that did not land leaves the card open and says why: the line changed
 * since, the file is gone, or it could not be written.
 */
const BaseApplyCard = ({ proposal, onApply, onKeep }: BaseApplyCardProps) => {
  const file = baseName(proposal.file);
  return (
    <Diff aria-label={`Proposed change to ${file}`}>
      <DiffHeader>
        <DiffTitle>
          {proposal.file}:{proposal.line}
        </DiffTitle>
        <DiffStat added={1} removed={1} />
      </DiffHeader>
      <DiffContent>
        <DiffLine variant="removed">{proposal.before}</DiffLine>
        <DiffLine variant="added">{proposal.after}</DiffLine>
      </DiffContent>
      <DiffFooter>
        {proposal.state === "open" ? (
          <div className="flex flex-col gap-2">
            {proposal.applyFailed && (
              <p role="status" className="text-caption text-error">
                {FAILED[proposal.applyFailed]}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={onApply}>
                Apply to {file}
              </Button>
              <Button variant="outline" size="sm" onClick={onKeep}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-caption text-subtle">{SETTLED[proposal.state]}</p>
        )}
      </DiffFooter>
    </Diff>
  );
};

export default BaseApplyCard;
