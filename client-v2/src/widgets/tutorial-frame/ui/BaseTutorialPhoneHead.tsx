/* eslint-disable unicorn/no-null -- the live step is null before Start, as the conversation hands it */
import { ChevronLeft, Code, MessageSquare } from "lucide-react";
import type { CSSProperties } from "react";
import { useState } from "react";

import { Button } from "@/shared/ui/button";

import type { TutorialSpace } from "../model/telemetry";
import type { PhoneStep } from "./BaseStepsSheet";
import BaseStepsSheet from "./BaseStepsSheet";
import StartOverDialog from "./StartOverDialog";

export type { PhoneStep } from "./BaseStepsSheet";

/** What moved the space from the header: its toggle, or a step picked in the sheet */
export type HeadSpaceSource = "toggle" | "step";

export interface BaseTutorialPhoneHeadProps {
  /** The tutorial's name */
  name: string;
  steps: readonly PhoneStep[];
  /** The live step's index, null before Start */
  live: number | null;
  started: boolean;
  /** Every step passed */
  finished: boolean;
  /** The tutorial's estimate, before Start */
  minutes: number;
  /** The space in view */
  space: TutorialSpace;
  /** The assistant wrote since Code was last in view */
  dot: boolean;
  /** Steps passed so far, for the sheet and Start over's question */
  passed: number;
  /** Back to the Tutorials page, progress kept */
  onBack: () => void;
  onSpace: (space: TutorialSpace, via: HeadSpaceSource) => void;
  /** Brings a reached step's heading into view in the feed */
  onJump: (index: number) => void;
  /** Clears the tutorial's progress; absent, the sheet has no "Start over…" */
  onStartOver?: () => Promise<void>;
}

/** The brand's progress fill: it starts purple and lands on green */
const PROGRESS_GRADIENT = "var(--gradient-product-flat)";

/**
 * One gradient laid across all the segments: each shows its own share, so the
 * gaps break a single bar instead of a colour a step
 */
const shareOf = (index: number, count: number): CSSProperties => ({
  backgroundImage: PROGRESS_GRADIENT,
  backgroundSize: `${count * 100}% 100%`,
  backgroundPosition: `${count > 1 ? (index / (count - 1)) * 100 : 0}% 0`,
});

/** Line 2 under the name: the size before Start, the step, or the finish */
const whereOf = ({
  steps,
  live,
  started,
  finished,
  minutes,
}: Pick<
  BaseTutorialPhoneHeadProps,
  "steps" | "live" | "started" | "finished" | "minutes"
>) => {
  const count = steps.length;
  // Not loaded yet: a tutorial always has steps, so "0 steps · 0 min" would
  // read as real
  if (count === 0) return "";
  if (!started || live === null) return `${count} steps · ${minutes} min`;
  if (finished) return `Done · ${count} of ${count}`;
  return `Step ${live + 1} of ${count} · ${steps[live]?.short ?? ""}`;
};

/** How many segments are lit: none before Start, all once done, else up to the live one */
const litOf = ({
  live,
  finished,
  count,
}: {
  live: number | null;
  finished: boolean;
  count: number;
}) => {
  if (live === null) return 0;
  return finished ? count : live + 1;
};

const toggleLabel = (onCode: boolean, dot: boolean) => {
  if (onCode) return "Back to the chat";
  return dot ? "Show the code, new lines written" : "Show the code";
};

/**
 * The phone's tutorial header, 76 px (Almaz's `StepScreen`): back to the
 * tutorials, the name and where the learner is as one button that opens the
 * steps, the Chat | Code toggle with Code's dot, and the step track along the
 * bottom edge, which stands in for the header's rule. It owns the steps
 * sheet and Start over's question.
 */
const BaseTutorialPhoneHead = ({
  name,
  steps,
  live,
  started,
  finished,
  minutes,
  space,
  dot,
  passed,
  onBack,
  onSpace,
  onJump,
  onStartOver,
}: BaseTutorialPhoneHeadProps) => {
  const [sheet, setSheet] = useState(false);
  const [startOver, setStartOver] = useState(false);
  const where = whereOf({ steps, live, started, finished, minutes });
  const onCode = space === "code";
  const lit = litOf({
    live: started ? live : null,
    finished,
    count: steps.length,
  });

  return (
    <header className="relative flex h-[4.75rem] shrink-0 items-center gap-1 pr-4 pb-4 pl-1">
      <Button
        variant="ghost"
        size="icon"
        className="size-11 shrink-0"
        aria-label="Back to tutorials"
        onClick={() => {
          setSheet(false);
          setStartOver(false);
          onBack();
        }}
      >
        <ChevronLeft className="size-6" aria-hidden />
      </Button>
      <button
        type="button"
        onClick={() => setSheet(true)}
        aria-label={
          where
            ? `${name}, ${where}. Show the steps`
            : `${name}. Show the steps`
        }
        className="flex h-11 min-w-0 flex-1 flex-col items-start justify-center rounded-lg px-1.5 text-left outline-none active:bg-surface-hover focus-visible:outline-2 focus-visible:outline-brand-purple"
      >
        <span className="max-w-full truncate font-heading text-[0.9375rem] leading-5 font-medium text-foreground">
          {name}
        </span>
        <span className="max-w-full truncate text-caption leading-[1.125rem] text-muted-foreground">
          {where}
        </span>
      </button>
      {/* 36 px to the eye, 44 to the finger from the layer round it */}
      <Button
        variant="ghost"
        aria-label={toggleLabel(onCode, dot)}
        onClick={() => onSpace(onCode ? "chat" : "code", "toggle")}
        className="relative h-9 shrink-0 gap-1.5 rounded-[10px] border-0 bg-foreground/10 px-3 text-[0.875rem] font-act text-foreground/90 shadow-none after:absolute after:-inset-1 after:content-[''] hover:bg-foreground/15 hover:text-foreground"
      >
        {onCode ? (
          <MessageSquare className="size-4" aria-hidden />
        ) : (
          <Code className="size-4" aria-hidden />
        )}
        {onCode ? "Chat" : "Code"}
        {dot && (
          <span
            aria-hidden
            data-dot
            className="absolute top-1.5 right-1.5 size-1.5 animate-pulse-dot rounded-full bg-brand-purple [animation-iteration-count:2]"
          />
        )}
      </Button>
      {started ? (
        <span
          aria-hidden
          className="absolute inset-x-4 bottom-2 grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
          }}
        >
          {steps.map((step, index) => (
            <span
              key={step.id}
              data-segment
              data-lit={index < lit}
              className="relative block h-1 w-full overflow-hidden rounded-[4px] bg-foreground/[0.12]"
            >
              <span
                style={{
                  ...shareOf(index, steps.length),
                  clipPath:
                    index < lit ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
                }}
                className="absolute inset-0 transition-[clip-path] duration-(--duration-slow) ease-out motion-reduce:transition-none"
              />
            </span>
          ))}
        </span>
      ) : (
        <span
          aria-hidden
          data-hairline
          className="absolute inset-x-0 bottom-0 h-px bg-border"
        />
      )}
      <BaseStepsSheet
        open={sheet}
        onOpenChange={setSheet}
        name={name}
        steps={steps}
        passed={passed}
        started={started}
        onPick={(index) => {
          onSpace("chat", "step");
          onJump(index);
          setSheet(false);
        }}
        onStartOver={
          onStartOver
            ? () => {
                setSheet(false);
                setStartOver(true);
              }
            : undefined
        }
      />
      {onStartOver && (
        <StartOverDialog
          open={startOver}
          onOpenChange={setStartOver}
          name={name}
          passed={passed}
          onConfirm={onStartOver}
        />
      )}
    </header>
  );
};

export default BaseTutorialPhoneHead;
