/** One rendered line of a unified diff */
export interface DiffLine {
  kind: "context" | "removed" | "added";
  /** Line number in the relevant file, or `null` for a gap marker */
  number: number | null;
  text: string;
}

/** How many unchanged lines to show around a change */
const CONTEXT_LINES = 3;

/**
 * Diff two versions of a file.
 *
 * Trims the common prefix and suffix and reports what is left as removed and
 * added. That is exact for the common case — a small edit inside a file — and
 * degrades to "the whole middle changed" for a rewrite, which is honest rather
 * than wrong. It is deliberately not an LCS diff: line-accurate minimal diffs
 * are not worth the cost or the failure modes here.
 *
 * @param before current content, or `null` for a new file
 * @param after proposed content
 * @returns lines to render
 */
export const diffLines = (before: string | null, after: string): DiffLine[] => {
  if (before === null) {
    return after
      .split("\n")
      .map((text, i) => ({ kind: "added" as const, number: i + 1, text }));
  }

  if (before === after) return [];

  const oldLines = before.split("\n");
  const newLines = after.split("\n");

  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }

  let fromEnd = 0;
  while (
    fromEnd < oldLines.length - start &&
    fromEnd < newLines.length - start &&
    oldLines[oldLines.length - 1 - fromEnd] ===
      newLines[newLines.length - 1 - fromEnd]
  ) {
    fromEnd++;
  }

  const removed = oldLines.slice(start, oldLines.length - fromEnd);
  const added = newLines.slice(start, newLines.length - fromEnd);

  const lines: DiffLine[] = [];

  const leadingFrom = Math.max(0, start - CONTEXT_LINES);
  if (leadingFrom > 0) lines.push({ kind: "context", number: null, text: "…" });
  for (let i = leadingFrom; i < start; i++) {
    lines.push({ kind: "context", number: i + 1, text: oldLines[i] });
  }

  removed.forEach((text, i) => {
    lines.push({ kind: "removed", number: start + i + 1, text });
  });
  added.forEach((text, i) => {
    lines.push({ kind: "added", number: start + i + 1, text });
  });

  const trailingEnd = Math.min(
    oldLines.length,
    oldLines.length - fromEnd + CONTEXT_LINES
  );
  for (let i = oldLines.length - fromEnd; i < trailingEnd; i++) {
    lines.push({ kind: "context", number: i + 1, text: oldLines[i] });
  }
  if (trailingEnd < oldLines.length) {
    lines.push({ kind: "context", number: null, text: "…" });
  }

  return lines;
};

/** Summarise a diff for the card header, e.g. "+1 −1" */
export const summarizeDiff = (lines: DiffLine[]) => {
  const added = lines.filter((l) => l.kind === "added").length;
  const removed = lines.filter((l) => l.kind === "removed").length;
  return { added, removed };
};
