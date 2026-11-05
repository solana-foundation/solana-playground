import type { ReactNode } from "react";

import type { Text } from "@/entities/tutorial";
import { cn } from "@/shared/lib/utils";

/** The desktop's copy of a definition's text; the phone's variant is 5.1's */
export const textOf = (text: Text): string =>
  typeof text === "string" ? text : text.text;

/** How long something took, as the cards say it: "41 s", "2 min 5 s" */
export const formatTook = (ms: number): string => {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const rest = seconds % 60;
  const minutes = `${Math.floor(seconds / 60)} min`;
  return rest ? `${minutes} ${rest} s` : minutes;
};

/** A run's own time, as the act record says it: "1.6 s" under ten seconds */
export const formatSeconds = (seconds: number): string =>
  seconds < 10
    ? `${Math.round(seconds * 10) / 10} s`
    : `${Math.round(seconds)} s`;

/** The code chip's ground: darker than the surface under it, with a 1 px ring inside */
export const CHIP =
  "bg-black/35 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)]";

/**
 * The chip's sizes, in whole pixels rather than a share of the text, so it is
 * the same in a 16 px line and in the quiz's 18: 22 tall by default, 23 for
 * the question (its capitals stand higher), 19 for a note on a 20 px line
 */
const CHIP_SIZE = {
  normal: "px-1 pt-[3px] pb-[3px] text-[14px] leading-4",
  large: "px-1 pt-[5px] pb-[2px] text-[14px] leading-4",
  small: "px-[3px] pt-px pb-[2px] text-[12px] leading-4",
} as const;

/** A stop right after a chip, which stays on the chip's line */
const STOP = /^[.,;:!?)\]]+/;

/**
 * Inline Markdown as the definition writes it: `code` spans and nothing
 * else, so a line of copy can name `msg!` without the card parsing more
 * than the definition can hold.
 *
 * The chip is the prototype's at `f7d42bf2e`: an inline block on a darker
 * ground with a faint inset ring, monospace at weight 350 in the text's own
 * colour, so a word of code does not outshine the headings. A stop right
 * after it is glued to it in one unbreakable run, 2 px clear of the ring: an
 * inline block lets the line break after it, and ". It used" started the
 * next line with its period.
 */
export const Prose = ({
  text,
  className,
  chip = "normal",
  codeClassName,
}: {
  text: Text | string;
  className?: string;
  /** The code chip's size; the text around it keeps the caller's */
  chip?: keyof typeof CHIP_SIZE;
  /** Classes merged over the chip's own, last, so a caller's ground wins */
  codeClassName?: string;
}) => {
  const parts = textOf(text).split("`");
  const out: ReactNode[] = [];
  // How much of the text part at an index a chip before it took as its stop
  const taken = new Map<number, number>();
  parts.forEach((part, i) => {
    // Even parts are text, odd ones sat between backticks
    if (i % 2 === 0) {
      out.push(part.slice(taken.get(i) ?? 0));
      return;
    }
    const stop = parts[i + 1]?.match(STOP)?.[0] ?? "";
    const code = (
      <code
        key={i}
        className={cn(
          "inline-block rounded-[4px] font-mono font-[350] whitespace-nowrap text-current",
          CHIP,
          CHIP_SIZE[chip],
          stop && "mr-[2px]",
          codeClassName
        )}
      >
        {part}
      </code>
    );
    if (!stop) {
      out.push(code);
      return;
    }
    out.push(
      <span key={`${i}-stop`} className="whitespace-nowrap">
        {code}
        {stop}
      </span>
    );
    taken.set(i + 1, stop.length);
  });
  return <span className={className}>{out}</span>;
};

/**
 * The 31 Oct reading scale (the prototype's `ui/type.ts` at `f7d42bf2e`):
 * the assistant's text 16/24 at 320, a step under the headings' white so a
 * long read does not glare
 */
export const READ =
  "text-[1rem] leading-[1.5rem] font-read tracking-normal text-foreground/80";

/** A card's heading: 20/24 at 500 */
export const HEADING =
  "font-heading text-[1.25rem] leading-[1.5rem] font-medium tracking-normal text-foreground";

/** A step's heading and the intro's title: 24/28 at 500 */
export const TITLE =
  "font-heading text-[1.5rem] leading-[1.75rem] font-medium tracking-normal text-foreground";

/** Code written out in a card, as a listing: 14/24 */
export const LISTING = "font-mono text-[0.875rem] leading-[1.5rem]";

/** The win and finish headlines: 28/32 at 500 */
export const HEADLINE =
  "font-heading text-[1.75rem] leading-8 font-medium tracking-[-0.02em] text-foreground";

/** A headline or a step's heading carries no full stop, whatever the definition wrote */
export const noStop = (text: Text): string =>
  textOf(text).replace(/(?<!\.)\.$/, "");
