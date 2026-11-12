import { FilePlus2, TriangleAlert } from "lucide-react";
import { useState } from "react";

import type { Wrote } from "@/features/tutorial-conversation";
import { Button } from "@/shared/ui/button";
import { Tag } from "@/shared/ui/tag";

import BaseResetStepDialog from "./BaseResetStepDialog";

export interface BaseWroteCardProps {
  /** The landing, its `lines` where the block is now (`linesNow`); null
   * when the block could not be written (`failed`) */
  wrote: Wrote | null;
  failed: boolean;
  /** The written lines, first to last (`previewOf`): as they landed, or as
   * the file holds them for a landing without text; the card shows three */
  preview: readonly string[];
  /** Open the file and bring the first written line into view */
  onShow: (file: string, line: number) => void;
  /**
   * Put the step back as it was entered, for a block that went to the end
   * of the file, once the learner confirms. Absent once the step has passed,
   * where the card is a record and offers no Reset.
   */
  onReset?: () => void;
  /** An act runs: Reset waits for it */
  resetDisabled?: boolean;
}

/** How many written lines the card shows before "N more lines" */
const PREVIEW_LINES = 3;

const baseName = (path: string) => path.split("/").pop() ?? path;

/** "line 9", or "lines 5 to 13" */
export const rangeOf = (lines: readonly number[]) => {
  const first = Math.min(...lines);
  const last = Math.max(...lines);
  return first === last ? `line ${first}` : `lines ${first} to ${last}`;
};

/**
 * The whole card is a raw `button`: the design system's `Button` draws a
 * control, not a card, and has no card variant (the prototype's wrote card is
 * one), so this keeps the card's own frame and draws its own focus outline.
 *
 * What a write put in a file: the path, the first three lines and "⋯ N
 * more lines" (the prototype's listing at `f7d42bf2e`). The whole card is the
 * button, and its label names the range. A created file reads
 * "Created <path>" with "New file"; a write that failed says the block is not
 * in the file. It stays a link once it is a record. A block the learner's own
 * lines kept from its place went to the end of the file: the card says so
 * under it and offers Reset beside the note, outside the card's button;
 * Reset asks before it restarts the step.
 */
const BaseWroteCard = ({
  wrote,
  failed,
  preview,
  onShow,
  onReset,
  resetDisabled = false,
}: BaseWroteCardProps) => {
  const [confirming, setConfirming] = useState(false);
  if (failed || !wrote) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 rounded-control border border-border bg-surface-panel px-3 py-2 text-caption text-warning-ink"
      >
        <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />I
        couldn&apos;t write that block, so it is not in your file.
      </p>
    );
  }

  const first = wrote.lines.length ? Math.min(...wrote.lines) : 1;
  if (wrote.created) {
    return (
      <button
        type="button"
        aria-label={`Show ${wrote.file}`}
        onClick={() => onShow(wrote.file, first)}
        className="flex h-8 w-full items-center gap-2 rounded-control border border-border bg-surface-panel px-3 text-left outline-none hover:border-border-strong focus-visible:outline-2 focus-visible:outline-brand-purple"
      >
        <FilePlus2
          aria-hidden="true"
          className="size-3.5 text-muted-foreground"
        />
        <span className="font-mono text-[0.75rem] text-foreground">
          Created {wrote.file}
        </span>
        <Tag className="ml-auto">New file</Tag>
      </button>
    );
  }

  const range = rangeOf(wrote.lines);
  const shown = preview.slice(0, PREVIEW_LINES);
  const more = wrote.lines.length - shown.length;
  const card = (
    <button
      type="button"
      aria-label={`Show ${range} in ${wrote.file}`}
      onClick={() => onShow(wrote.file, first)}
      className="w-full overflow-hidden rounded-control border border-border bg-surface-panel text-left outline-none hover:border-border-strong focus-visible:outline-2 focus-visible:outline-brand-purple"
    >
      {/* The file's path alone: the numbers under it say which lines, and
          the whole card opens them */}
      <span className="flex h-8 items-center px-3">
        <span className="min-w-0 truncate font-mono text-[0.75rem] text-foreground">
          {wrote.file}
        </span>
      </span>
      {/* Two columns: the numbers start 12 in, under the path, and hold
          still; only the code beside them scrolls sideways */}
      <span className="flex pb-2 font-mono text-[0.75rem] leading-5">
        <span
          aria-hidden="true"
          className="w-[1.625rem] shrink-0 pl-3 text-subtle tabular-nums select-none"
        >
          {shown.map((_, i) => (
            <span key={i} className="block">
              {first + i}
            </span>
          ))}
        </span>
        <span className="block min-w-0 flex-1 overflow-x-auto pr-3 pl-2">
          {shown.map((line, i) => (
            <span
              key={i}
              // A blank line keeps its row, so the numbers stay beside their code
              className="block min-h-5 whitespace-pre text-foreground"
            >
              {line}
            </span>
          ))}
        </span>
      </span>
      {/* What is left of the run, as the listing's last row: an ellipsis in
          the numbers' column, the words on the code's edge */}
      {more > 0 && (
        <span className="-mt-1 flex pb-2 text-[0.75rem] leading-5 text-subtle">
          <span
            aria-hidden="true"
            className="w-[1.625rem] shrink-0 pl-3 font-mono select-none"
          >
            ⋯
          </span>
          <span className="pl-2">
            {more} more {more === 1 ? "line" : "lines"}
          </span>
        </span>
      )}
    </button>
  );
  if (!wrote.appended) return card;
  return (
    <div className="grid gap-2">
      {card}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="text-caption text-muted-foreground">
          I put it at the end: your own lines are kept.
        </p>
        {onReset && (
          <Button
            variant="outline"
            size="xs"
            disabled={resetDisabled}
            onClick={() => setConfirming(true)}
          >
            Reset {baseName(wrote.file)} to this step&apos;s start
          </Button>
        )}
      </div>
      {onReset && (
        <BaseResetStepDialog
          open={confirming}
          onOpenChange={setConfirming}
          file={baseName(wrote.file)}
          onConfirm={onReset}
        />
      )}
    </div>
  );
};

export default BaseWroteCard;
