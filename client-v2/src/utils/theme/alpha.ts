/**
 * How much of a colour shows through, for the three weights the removed themes
 * wrote as hex suffixes (`16`, `64`, `bb` of `ff`), kept so the panels look
 * the same.
 */
export const ALPHA = { low: "9%", medium: "39%", high: "73%" } as const;

export type AlphaLevel = keyof typeof ALPHA;

/**
 * A colour at a lower opacity. Works on any CSS colour, `var(--token)`
 * included, which appending a hex suffix never did.
 */
export const alpha = (color: string, level: AlphaLevel) =>
  `color-mix(in srgb, ${color} ${ALPHA[level]}, transparent)`;
