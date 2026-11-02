import { useEffect } from "react";

import type { Text } from "@/entities/tutorial";
import { Button } from "@/shared/ui/button";
import { Kbd } from "@/shared/ui/kbd";
import { Prose, READ } from "./Prose";

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

/** Whether a key press reached the page with no control of its own holding focus */
const nothingFocused = () => {
  const active = document.activeElement;
  return !active || active === document.body;
};

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
      className="flex flex-col gap-4 rounded-panel border border-border bg-surface-panel p-4"
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
            className="font-heading text-base font-medium text-foreground"
          >
            {name}
          </h2>
          <p className="text-[0.75rem] text-subtle tabular-nums">
            {minutes} min · {stepCount} steps
          </p>
        </div>
      </div>
      <p className={READ}>{INTRO_NOTE}</p>
      <div className="flex flex-col gap-1">
        <h3 className="text-caption text-muted-foreground">
          What you&apos;ll build
        </h3>
        <p className={READ}>
          <Prose text={promise} />
        </p>
        <p className="rounded-control border-l-2 border-success bg-surface-well px-3 py-1.5 font-mono text-[0.75rem] text-foreground">
          {log}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-caption text-muted-foreground">How it goes</h3>
        <p className={READ}>{HOW_IT_GOES}</p>
      </div>
      <div>
        <Button size="lg" onClick={onStart}>
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
