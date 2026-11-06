import { ArrowRight, Check } from "lucide-react";

import type { Text } from "@/entities/tutorial";
import type { LandedCall } from "@/features/tutorial-conversation";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleHeading,
} from "@/shared/ui/collapsible";
import { CopyButton } from "@/shared/ui/copy-button";
import { Tag } from "@/shared/ui/tag";

import { BaseDrawnCheck } from "./BaseDrawnCheck";
import BaseReceipt, { receiptText } from "./BaseReceipt";
import { ACTION, ACTION_FILL, ACTION_SOFT, PHONE_CTA } from "./card-action";
import { usePhone } from "./phone";
import { formatTook, HEADLINE, noStop, Prose, READ } from "./Prose";

/** The finish card's tag, its "Step n done": the whole tutorial is a win */
export const FINISH_TAG = "Tutorial complete";

/** The finish card's meta line, the wallet copy of `tutorial-runs` */
export const finishMeta = (steps: number, seconds: number) =>
  `${steps} steps · ${formatTook(
    seconds * 1000
  )} · devnet only, nothing real spent`;

export interface BaseFinishCardProps {
  headline: Text;
  line: Text;
  /** The definition's "What you learned" */
  learned: readonly string[];
  steps: number;
  /** Whole seconds from Start to the finish */
  seconds: number;
  /** The last landed call, whose receipt "Transaction details" holds, or null */
  receipt: LandedCall | null;
  /** The next tutorial's name, or null when the definition names none */
  next: string | null;
  onNext: () => void;
  onAllTutorials: () => void;
  /** Copy receipt was pressed */
  onCopyReceipt: () => void;
  onCopyError: (error: unknown) => void;
}

/**
 * The card a tutorial ends on, marked as a win like a step's (a drawn check
 * and "Tutorial complete"), proof first: the headline and line, the last
 * call's receipt folded under "Transaction details" with Copy receipt on its
 * row, "What you learned", the meta line, and "Next: <tutorial>" with "All
 * tutorials". No stat pills and no "See summary" (Almaz, 3.14 and 3.15).
 * Without a landed call, or with one that left nothing to show (no
 * signature, line or receipt field), there is no "Transaction details".
 */
const BaseFinishCard = ({
  headline,
  line,
  learned,
  steps,
  seconds,
  receipt,
  next,
  onNext,
  onAllTutorials,
  onCopyReceipt,
  onCopyError,
}: BaseFinishCardProps) => {
  const { phone } = usePhone();
  return (
    <section
      aria-label="Finished"
      className="flex items-start gap-3 rounded-card border border-border bg-surface-panel p-5"
    >
      <BaseDrawnCheck draw />
      {/* One column beside the check, as on the win card, so every part of
        the card starts where the headline does */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Tag className="w-fit">{FINISH_TAG}</Tag>
          <h2 className={HEADLINE}>
            <Prose text={noStop(headline, phone)} />
          </h2>
          <p className={READ}>
            <Prose text={line} />
          </p>
        </div>

        {receipt && receiptText(receipt) && (
          <Collapsible className="flex flex-col gap-2 rounded-control border border-border bg-surface-well/50 px-3 py-2">
            <div className="flex items-center gap-2">
              <CollapsibleHeading className="text-caption">
                <CollapsibleChevron />
                Transaction details
              </CollapsibleHeading>
              <CopyButton
                value={receiptText(receipt)}
                label="Copy receipt"
                onClickCapture={onCopyReceipt}
                onError={onCopyError}
                className="ml-auto"
              />
            </div>
            <CollapsibleContent>
              <BaseReceipt call={receipt} onCopyError={onCopyError} />
            </CollapsibleContent>
          </Collapsible>
        )}

        {learned.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-caption font-label text-muted-foreground">
              What you learned
            </h3>
            <ul className="flex flex-col gap-1.5">
              {learned.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2 text-control text-foreground"
                >
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 text-success"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-caption text-subtle tabular-nums">
          {finishMeta(steps, seconds)}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {next && (
            <Button
              className={cn(ACTION, ACTION_FILL, PHONE_CTA)}
              onClick={onNext}
            >
              Next: {next}
              <ArrowRight aria-hidden="true" />
            </Button>
          )}
          <Button
            variant="ghost"
            className={cn(ACTION, ACTION_SOFT, PHONE_CTA)}
            onClick={onAllTutorials}
          >
            All tutorials
          </Button>
        </div>
      </div>
    </section>
  );
};

export default BaseFinishCard;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/tutorial-conversation/ui/BaseFinishCard", () => {
    it("says the meta line in the wallet copy's words", () => {
      expect(finishMeta(4, 45)).toBe(
        "4 steps · 45 s · devnet only, nothing real spent"
      );
      expect(finishMeta(4, 252)).toBe(
        "4 steps · 4 min 12 s · devnet only, nothing real spent"
      );
    });
  });
}
