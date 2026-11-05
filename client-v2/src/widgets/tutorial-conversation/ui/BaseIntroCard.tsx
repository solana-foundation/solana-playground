import { useEffect } from "react";

import type { Text } from "@/entities/tutorial";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Kbd } from "@/shared/ui/kbd";

import { ACTION, ACTION_FILL } from "./card-action";
import { nothingFocused } from "./keys";
import { HEADING, Prose, READ, TITLE } from "./Prose";

/** The wallet copy of `tutorial-runs`, Almaz's of 28 Oct, verbatim */
export const INTRO_NOTE =
  "A devnet wallet is set up for you with free test SOL. Your progress stays in this browser";

/** The loop every step runs, as the intro card names it */
export const HOW_IT_GOES =
  "I explain a piece, you pick an answer, I write the code, you build and run it";

export interface BaseIntroCardProps {
  name: string;
  thumbnail: string;
  minutes: number;
  stepCount: number;
  /** The definition's promise line */
  promise: Text;
  /** The log line the finished program prints */
  log: string;
  onStart: () => void;
}

/**
 * The card a conversation tutorial opens on: what it builds, how it goes, and
 * "Start step 1". It is the live card before Start, so Enter starts too while
 * nothing else holds focus. It leaves the feed on Start; it has no record.
 * The connected feed keeps the editor read only while it shows
 * (`useLockedPreview`).
 */
const BaseIntroCard = ({
  name,
  thumbnail,
  minutes,
  stepCount,
  promise,
  log,
  onStart,
}: BaseIntroCardProps) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented || !nothingFocused()) return;
      e.preventDefault();
      onStart();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onStart]);

  return (
    <section
      aria-labelledby="tutorial-intro-name"
      className="flex flex-col rounded-panel border border-border bg-surface-panel p-5"
    >
      <div className="flex items-center gap-3">
        <img
          src={thumbnail}
          alt=""
          className="size-10 shrink-0 rounded-lg object-cover"
        />
        <div className="min-w-0">
          <h2
            id="tutorial-intro-name"
            title={name}
            className={cn(TITLE, "truncate")}
          >
            {name}
          </h2>
          <p className="text-[0.75rem] text-subtle tabular-nums">
            {minutes} min · {stepCount} steps
          </p>
        </div>
      </div>
      {/* 24 under the head, so the name and its meta read as the card's
          head and not as the first line of the text */}
      <p className={cn(READ, "mt-6")}>{INTRO_NOTE}</p>
      {/* A heading has 30 over it and 9 under, so it belongs to what it heads */}
      <h3 className={cn(HEADING, "mt-[30px]")}>What you&apos;ll build</h3>
      <p className={cn(READ, "mt-[9px]")}>
        <Prose text={promise} />
      </p>
      <p
        aria-label="What your program prints at the end"
        className="mt-[9px] rounded-lg bg-foreground/[0.05] px-3 py-2.5 font-mono text-[0.8125rem] leading-[1.5] text-foreground/90"
      >
        {log}
      </p>
      <h3 className={cn(HEADING, "mt-[30px]")}>How it goes</h3>
      <p className={cn(READ, "mt-[9px]")}>{HOW_IT_GOES}</p>
      <div className="mt-6">
        <Button className={cn(ACTION, ACTION_FILL, "px-5")} onClick={onStart}>
          Start step 1
          <Kbd
            aria-hidden="true"
            className="bg-white/15 text-primary-foreground/80"
          >
            ↵
          </Kbd>
        </Button>
      </div>
    </section>
  );
};

export default BaseIntroCard;
