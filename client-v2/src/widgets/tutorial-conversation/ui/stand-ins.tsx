import { Check } from "lucide-react";

import type { Ask, Text, Win } from "@/entities/tutorial";
import type { AskOutcome } from "@/features/tutorial-conversation";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Prose, READ } from "./Prose";

/**
 * Plain stand-ins for the turns other tickets draw, so a tutorial can still be
 * walked from the feed: the question card is 3.5's (HOO-2353), the win and
 * finish cards 3.4's (HOO-2352). Each draws only enough to move the lesson on.
 */

/** How a resolved question's record ends, after its right option */
export const QUALIFIER: Record<AskOutcome, (attempts: number) => string> = {
  first_try: () => "first try",
  retry: (attempts) => (attempts === 2 ? "2nd try" : "3rd try"),
  typed: () => "typed by you",
  skipped: () => "skipped",
  call_panel: () => "skipped, called from the Call panel",
};

export interface AskStandInProps {
  ask: Ask;
  open: boolean;
  /** Option indexes picked wrong, in order */
  wrong: readonly number[];
  outcome: AskOutcome | null;
  attempts: number;
  /** Another act runs: the options wait */
  disabled: boolean;
  onPick: (option: number) => void;
  onHint: () => void;
  onSkip: () => void;
}

// TODO(tutorial-flow-v2 3.5): HOO-2353's question card replaces this: the
// keys, "Not quite." with its reason, Type it myself, the expandable record.
// Until then a wrong pick only dims its option and says "Not quite.", so a
// click is never silent
export const AskStandIn = ({
  ask,
  open,
  wrong,
  outcome,
  attempts,
  disabled,
  onPick,
  onHint,
  onSkip,
}: AskStandInProps) => {
  if (!open) {
    return (
      <p className="flex items-center gap-2 text-caption text-foreground">
        <Check aria-hidden="true" className="size-3.5 text-success" />
        <Prose text={ask.options[ask.answer]} />
        {outcome && (
          <span className="text-subtle">· {QUALIFIER[outcome](attempts)}</span>
        )}
      </p>
    );
  }
  return (
    <section
      aria-label={
        typeof ask.question === "string" ? ask.question : ask.question.text
      }
      className="flex flex-col gap-2 rounded-panel border border-border bg-surface-panel p-3"
    >
      <p className="font-heading text-base text-foreground">
        <Prose text={ask.question} />
      </p>
      <div role="group" className="flex flex-col gap-2">
        {ask.options.map((option, i) => (
          <Button
            key={i}
            variant="outline"
            disabled={disabled}
            aria-disabled={wrong.includes(i) || undefined}
            onClick={() => !wrong.includes(i) && onPick(i)}
            className={cn(
              "h-auto justify-start whitespace-normal py-2 text-left",
              wrong.includes(i) && "cursor-default opacity-50 line-through"
            )}
          >
            <Prose
              text={option}
              className={ask.code ? "font-mono" : undefined}
            />
          </Button>
        ))}
      </div>
      <p role="status" className="text-caption text-error empty:hidden">
        {wrong.length > 0 ? "Not quite." : ""}
      </p>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onHint}>
          Hint
        </Button>
        <Button variant="ghost" size="sm" onClick={onSkip}>
          Skip
        </Button>
      </div>
    </section>
  );
};

export interface WinStandInProps {
  win: Win;
  /** 1-based */
  index: number;
  /** The next step's title, unless this is the last step */
  next: string | null;
  /** Next was pressed, or the finish followed */
  done: boolean;
  onNext: () => void;
}

// TODO(tutorial-flow-v2 3.4): HOO-2352's win card replaces this: the drawn
// check, Enter for Next, "Open Call" / "Write it in client.ts"
export const WinStandIn = ({
  win,
  index,
  next,
  done,
  onNext,
}: WinStandInProps) => (
  <section
    aria-label={`Step ${index} done`}
    className="flex flex-col gap-2 rounded-panel border border-border bg-surface-panel p-4"
  >
    <p className="text-[0.75rem] text-success">Step {index} done</p>
    <p className="font-heading text-title text-foreground">
      <Prose text={win.headline} />
    </p>
    {!done && (
      <>
        <p className={READ}>
          <Prose text={win.line} />
        </p>
        {next && (
          <div>
            <Button onClick={onNext}>Next: {next}</Button>
          </div>
        )}
      </>
    )}
  </section>
);

// TODO(tutorial-flow-v2 3.4): HOO-2352's finish card replaces this: the
// receipt, "What you learned", the meta line and "Next: <tutorial>"
export const FinishStandIn = ({
  headline,
  line,
}: {
  headline: Text;
  line: Text;
}) => (
  <section
    aria-label="Finished"
    className="flex flex-col gap-2 rounded-card border border-border bg-surface-panel p-5"
  >
    <p className="font-heading text-title text-foreground">
      <Prose text={headline} />
    </p>
    <p className={READ}>
      <Prose text={line} />
    </p>
  </section>
);
