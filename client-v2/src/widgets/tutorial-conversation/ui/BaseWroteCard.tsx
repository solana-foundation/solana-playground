import { useState } from "react";
import { ArrowUpRight, FileCode, FilePlus2, TriangleAlert } from "lucide-react";

import type { Wrote } from "@/features/tutorial-conversation";
import { Button } from "@/shared/ui/button";
import { Tag } from "@/shared/ui/tag";
import BaseResetStepDialog from "./BaseResetStepDialog";

export interface BaseWroteCardProps {
  /** Null when the block could not be written (`failed`) */
  wrote: Wrote | null;
  failed: boolean;
  /** The written lines as the file holds them, first to last; the card shows three */
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
 * What a write put in a file: the path, the range, the first three lines and
 * "Show in <file>". The whole card is the button. A created file reads
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
      <span className="flex h-8 items-center gap-2 px-3">
        <FileCode
          aria-hidden="true"
          className="size-3.5 text-muted-foreground"
        />
        <span className="font-mono text-[0.75rem] text-foreground">
          {wrote.file}
        </span>
        <span className="text-[0.75rem] text-subtle">{range}</span>
        <span className="ml-auto font-mono text-[0.75rem] text-success tabular-nums">
          +{wrote.lines.length}
        </span>
      </span>
      <span className="block bg-surface-well font-mono text-[0.75rem] leading-[1.6]">
        {shown.map((line, i) => (
          <span
            key={i}
            className="block border-l-2 border-success/50 bg-success/5 px-3 whitespace-pre"
          >
            <span className="mr-3 text-subtle tabular-nums">{first + i}</span>
            {line}
          </span>
        ))}
        {more > 0 && (
          <span className="block px-3 text-subtle">
            {more} more {more === 1 ? "line" : "lines"}
          </span>
        )}
      </span>
      <span className="flex h-[1.875rem] items-center gap-1 border-t border-border px-3 text-[0.75rem] text-muted-foreground">
        <ArrowUpRight aria-hidden="true" className="size-3.5" />
        Show in {baseName(wrote.file)}
      </span>
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
