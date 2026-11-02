import type { Text } from "@/entities/tutorial";

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

/**
 * Inline Markdown as the definition writes it: `code` spans and nothing
 * else, so a line of copy can name `msg!` without the card parsing more
 * than the definition can hold.
 */
export const Prose = ({
  text,
  className,
}: {
  text: Text | string;
  className?: string;
}) => {
  const parts = textOf(text).split("`");
  return (
    <span className={className}>
      {parts.map((part, i) =>
        // Odd parts sat between backticks
        i % 2 === 1 ? (
          <code
            key={i}
            className="rounded-sm bg-surface-raised px-1 font-mono text-[0.875em] text-foreground"
          >
            {part}
          </code>
        ) : (
          part
        )
      )}
    </span>
  );
};

/** The assistant's prose, as SPEC.md's `READ` sets it */
export const READ =
  "text-[0.9375rem] leading-[1.6] font-read text-foreground/70";
