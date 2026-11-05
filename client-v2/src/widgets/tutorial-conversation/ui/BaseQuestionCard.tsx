/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import {
  Check,
  ChevronRight,
  Lightbulb,
  PenLine,
  SkipForward,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { Ask } from "@/entities/tutorial";
import type { AskOutcome } from "@/features/tutorial-conversation";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import { typing } from "./keys";
import { HEADING, LISTING, Prose } from "./Prose";

/** How long a right pick shows green before the card folds to its record */
export const RIGHT_HOLD_MS = 500;

/** How a resolved question's record ends, after its right option */
export const QUALIFIER: Record<AskOutcome, (attempts: number) => string> = {
  first_try: () => "first try",
  retry: (attempts) => (attempts === 2 ? "2nd try" : "3rd try"),
  typed: () => "typed by you",
  skipped: () => "skipped",
  call_panel: () => "skipped, called from the Call panel",
};

/**
 * Whether the learner gave the answer (a green check on the record) or the
 * question was passed by (a skip mark): a skip was not got right
 */
const ANSWERED: Record<AskOutcome, boolean> = {
  first_try: true,
  retry: true,
  typed: true,
  skipped: false,
  call_panel: false,
};

const ROWS = [0, 1, 2] as const;

type RowState = "right" | "wrong" | "left";

const rowState = (right: boolean, wrong: boolean): RowState => {
  if (right) return "right";
  if (wrong) return "wrong";
  return "left";
};

/**
 * An option as its row shows it. `line` keeps a code option on one line, for
 * the record, whose row truncates it; `ruled` draws a ruled-out option in one
 * grey, so the reason under it reads first.
 */
const OptionText = ({
  ask,
  i,
  line = false,
  ruled = false,
}: {
  ask: Ask;
  i: number;
  line?: boolean;
  ruled?: boolean;
}) => {
  // One colour for code, as Practicum sets its options: syntax colours
  // picked out some answers over others and read as hints
  const tone = ruled ? "text-muted-foreground" : "text-foreground";
  if (ask.code) {
    return (
      <code
        className={cn(
          LISTING,
          line ? "whitespace-pre" : "block whitespace-pre-wrap break-words",
          tone
        )}
      >
        {ask.options[i]}
      </code>
    );
  }
  return (
    <span className={cn("text-[1rem] leading-[1.5rem]", tone)}>
      <Prose text={ask.options[i]} />
    </span>
  );
};

export interface BaseQuestionRecordProps {
  ask: Ask;
  /** "Q1" for the tutorial's first question, "Fix" for a fix question */
  label: string;
  outcome: AskOutcome;
  attempts: number;
  /** The options picked wrong before it resolved */
  wrong: readonly number[];
}

/**
 * A resolved question: one line, the answer it ended on and how. A click
 * opens the question and its three rows in their final states, with the
 * reasons.
 */
export const BaseQuestionRecord = ({
  ask,
  label,
  outcome,
  attempts,
  wrong,
}: BaseQuestionRecordProps) => {
  const [open, setOpen] = useState(false);
  const answered = ANSWERED[outcome];
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="group/rec flex min-h-9 w-full items-center gap-2 rounded-control border border-border bg-surface-panel px-3 py-1.5 text-left text-caption hover:border-border-strong"
      >
        <span className="shrink-0 font-label text-[0.75rem] tabular-nums text-subtle">
          {label}
        </span>
        {answered ? (
          <Check
            strokeWidth={2.5}
            className="size-3.5 shrink-0 text-success"
            aria-hidden="true"
          />
        ) : (
          <SkipForward
            strokeWidth={2}
            className="size-3.5 shrink-0 text-subtle"
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 truncate">
          <OptionText ask={ask} i={ask.answer} line />
        </span>
        <span className="shrink-0 text-subtle">
          · {QUALIFIER[outcome](attempts)}
        </span>
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "ml-auto size-3.5 shrink-0 text-subtle transition-transform duration-150 group-hover/rec:text-foreground motion-reduce:transition-none",
            open && "rotate-90"
          )}
        />
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-1.5">
          <p className="px-0.5 text-caption text-muted-foreground">
            <Prose text={ask.question} />
          </p>
          {ROWS.map((i) => {
            const right = i === ask.answer;
            const ruled = wrong.includes(i);
            return (
              <div
                key={i}
                data-state={rowState(right, ruled)}
                className={cn(
                  "flex min-h-10 items-start gap-3 rounded-lg border px-3 py-2",
                  right && "border-success/40 bg-success/5",
                  ruled && "border-error/25 bg-error/[0.05]",
                  !right && !ruled && "border-border"
                )}
              >
                <span className="mt-px grid size-6 shrink-0 place-items-center rounded-sm bg-muted font-act text-[0.75rem] tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <OptionText ask={ask} i={i} ruled={ruled} />
                  {ask.why[i] && (
                    <span className="mt-1 block text-caption text-muted-foreground">
                      <Prose text={ask.why[i] ?? ""} />
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * An open question that is not the card that acts: its words only, so no
 * button on it competes with the live card's.
 */
export const BaseQuestionWaiting = ({
  ask,
  label,
}: {
  ask: Ask;
  label: string;
}) => (
  <p className="flex min-h-9 items-center gap-2 rounded-control border border-border px-3 py-1.5 text-caption text-muted-foreground">
    <span className="shrink-0 font-label text-[0.75rem] tabular-nums text-subtle">
      {label}
    </span>
    <span className="min-w-0 truncate">
      <Prose text={ask.question} />
    </span>
  </p>
);

/** An open dialog or menu, which owns the keyboard and the focus */
const OVERLAY = "[role='dialog'], [role='alertdialog'], [role='menu']";

/**
 * Whether a key press is the live question's to take. A field keeps its
 * typing; a chord (⌘S saves), a held key's repeat, an IME composition and a
 * press something else already handled stay out; and an open dialog or menu
 * owns the keyboard, so S there never skips the question behind it. The
 * caller also requires the focus on the card or on nothing (WCAG 2.1.4: a
 * one-letter shortcut is active only on focus), which the card takes as it
 * arrives.
 */
const ownsKey = (e: KeyboardEvent) =>
  !typing(e.target) &&
  !e.metaKey &&
  !e.ctrlKey &&
  !e.altKey &&
  !e.repeat &&
  !e.isComposing &&
  !e.defaultPrevented &&
  !document.querySelector(OVERLAY);

export interface BaseQuestionCardProps {
  ask: Ask;
  /** The options picked wrong so far, in order */
  wrong: readonly number[];
  /** The hint was given: its button goes, the hint stays in the feed */
  hinted: boolean;
  /** Another act runs: the options wait */
  disabled: boolean;
  onPick: (option: number) => void;
  onHint: () => void;
  onSkip: () => void;
  /** Put the caret where the answer lands; only for a question that writes */
  onTypeIt: () => void;
}

/**
 * The live question: three rows to pick from. A right pick turns green and
 * holds for `RIGHT_HOLD_MS` before it is sent, so the card folds into its
 * record as the assistant writes. A wrong pick is sent at once: it turns
 * red, shakes, says "Not quite." and why, and the focus moves to the next
 * row still to pick; after two wrong, the last row is outlined. Keys work
 * while the focus is on the card or on nothing (`ownsKey`): 1 to 3 pick, ↑
 * and ↓ move, H hints, S skips.
 */
const BaseQuestionCard = ({
  ask,
  wrong,
  hinted,
  disabled,
  onPick,
  onHint,
  onSkip,
  onTypeIt,
}: BaseQuestionCardProps) => {
  const titleId = useId();
  const reasonId = useId();
  const box = useRef<HTMLElement>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const [right, setRight] = useState<number | null>(null);
  const [shake, setShake] = useState<{ i: number; n: number } | null>(null);

  const left = ROWS.filter((i) => !wrong.includes(i));
  const lastOne = wrong.length === 2 ? left[0] : null;

  // It takes the focus as it arrives, so the keys work at once, without
  // scrolling the feed; a learner typing in the composer keeps their field.
  // Nor does it take the focus out of an open dialog, menu or popover (the
  // workspace's file tree): those close when the focus leaves them
  useEffect(() => {
    const card = box.current;
    const active = document.activeElement;
    if (!card || typing(active)) return;
    const overlay = active?.closest(OVERLAY);
    if (overlay && !overlay.contains(card)) return;
    card.focus({ preventScroll: true });
  }, []);

  // The right pick's hold, cancelled if the card goes before it ends. The
  // green is let go once sent: a pick the engine refused (an act started
  // meanwhile) leaves the rows pickable rather than one green row stuck
  useEffect(() => {
    if (right === null) return;
    const t = window.setTimeout(() => {
      onPick(right);
      setRight(null);
    }, RIGHT_HOLD_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one send per right pick
  }, [right]);

  /** Focus on the card, or on nothing in particular */
  const inside = (el: Element | null) =>
    !el || el === document.body || !!box.current?.contains(el);

  const pick = (i: number) => {
    if (disabled || right !== null || wrong.includes(i)) return;
    if (i === ask.answer) {
      setRight(i);
      return;
    }
    onPick(i);
    setShake({ i, n: (shake?.n ?? 0) + 1 });
    const next =
      ROWS.find((k) => k > i && !wrong.includes(k)) ??
      ROWS.find((k) => k !== i && !wrong.includes(k));
    // Only while the learner is still here: a click on "Type it myself" in
    // the same frame keeps the editor
    if (next !== undefined) {
      requestAnimationFrame(() => {
        if (!inside(document.activeElement)) return;
        rows.current[next]?.focus();
      });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!ownsKey(e) || !inside(document.activeElement)) return;
      const n = ["1", "2", "3"].indexOf(e.key);
      if (n !== -1) {
        e.preventDefault();
        pick(n);
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        onSkip();
      } else if (key === "h") {
        e.preventDefault();
        if (!hinted) onHint();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const at = rows.current.findIndex((r) => r === document.activeElement);
        const down = e.key === "ArrowDown";
        // From no row, ↓ lands on the first and ↑ on the last
        let from = at;
        if (at === -1) from = down ? -1 : ROWS.length;
        const to = down
          ? ROWS.find((k) => k > from)
          : [...ROWS].reverse().find((k) => k < from);
        if (to !== undefined) {
          e.preventDefault();
          rows.current[to]?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const lastWrong = wrong.at(-1);

  return (
    <section
      ref={box}
      tabIndex={-1}
      aria-labelledby={titleId}
      // The ring and the shadow mark the one card that waits on the learner.
      // As Practicum's quiz, it steps out past the text column to 8 px from
      // the panel's edges, 40 under the text before it
      className="-mx-3 mt-[25px] rounded-panel p-5 pb-[19px] shadow-[0_8px_24px_rgb(0_0_0/0.3)] outline-none gradient-stroke [--stroke-fill:var(--surface-panel)]"
    >
      {/* The quiz question, 18/26: what you answer reads as the card's own
          title, a step over the 16 px text before it */}
      <h3
        id={titleId}
        className={cn(HEADING, "mb-3 text-[1.125rem] leading-[1.625rem]")}
      >
        <Prose text={ask.question} chip="large" />
      </h3>
      <div
        role="group"
        aria-labelledby={titleId}
        className={cn(
          "flex flex-col gap-2",
          disabled && "pointer-events-none opacity-50"
        )}
      >
        {ROWS.map((i) => {
          const ruled = wrong.includes(i);
          const isRight = right === i;
          return (
            <button
              key={i}
              ref={(el) => {
                rows.current[i] = el;
              }}
              type="button"
              aria-disabled={ruled || disabled || undefined}
              aria-describedby={ruled ? `${reasonId}-${i}` : undefined}
              data-state={rowState(isRight, ruled)}
              data-shake={shake?.i === i ? shake.n : undefined}
              onClick={() => pick(i)}
              className={cn(
                "group/opt flex min-h-11 w-full items-start gap-3 rounded-lg border py-3 pl-3.5 pr-4 text-left outline-none transition-colors duration-100 active:translate-y-px motion-reduce:transition-none",
                isRight && "border-success/50 bg-success/10",
                ruled && "cursor-default border-error/25 bg-error/[0.05]",
                !isRight &&
                  !ruled &&
                  "border-border bg-foreground/[0.02] hover:border-foreground/25 hover:bg-foreground/[0.05] focus-visible:border-foreground/25 focus-visible:bg-foreground/[0.05] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-purple",
                lastOne === i &&
                  !isRight &&
                  "border-foreground/30 bg-foreground/[0.04]",
                shake?.i === i && "pg-shake"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid h-6 w-[1.125rem] shrink-0 place-items-center rounded-sm"
                )}
              >
                {isRight && (
                  <span className="grid size-[1.125rem] animate-pop place-items-center rounded-[5px] bg-success text-success-foreground">
                    <Check strokeWidth={2.75} className="size-3" />
                  </span>
                )}
                {ruled && (
                  <span className="grid size-[1.125rem] place-items-center rounded-[5px] bg-error/15 text-error">
                    <X strokeWidth={2.75} className="size-3" />
                  </span>
                )}
                {!isRight && !ruled && (
                  <span className="size-4 rounded-full border-[1.5px] border-muted-foreground/70 transition-colors group-hover/opt:border-foreground group-focus-visible/opt:border-foreground" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block leading-[1.5rem]",
                    !ask.code && "font-read"
                  )}
                >
                  <OptionText ask={ask} i={i} ruled={ruled} />
                </span>
                {ruled && ask.why[i] && (
                  <span
                    id={`${reasonId}-${i}`}
                    className="mt-2 block text-caption leading-5 text-foreground/80 duration-150 animate-in fade-in slide-in-from-top-1 motion-reduce:animate-none"
                  >
                    <span className="font-medium text-foreground">
                      Not quite.
                    </span>{" "}
                    <Prose text={ask.why[i] ?? ""} chip="small" />
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p aria-live="polite" className="sr-only">
        {lastWrong !== undefined
          ? `Not quite. ${ask.why[lastWrong] ?? ""}`.trim()
          : ""}
      </p>
      <div className="-mx-2.5 mt-5 flex items-center gap-1">
        {ask.writes && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={onTypeIt}
          >
            <PenLine />
            Type it myself
          </Button>
        )}
        {!hinted && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-subtle hover:text-muted-foreground"
            onClick={onHint}
          >
            <Lightbulb />
            Hint
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "text-subtle hover:text-muted-foreground",
            hinted && "ml-auto"
          )}
          onClick={onSkip}
        >
          Skip
        </Button>
      </div>
    </section>
  );
};

export default BaseQuestionCard;
