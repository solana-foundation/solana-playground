import { diffArrays } from "diff";

import type {
  Chunk,
  FileConflict,
  ResolvedFiles,
  SettledChange,
} from "../../model/merge";

/** The three panes of the resolve view, by the design system's names */
export type MergePane = "left" | "result" | "right";

/** The two sides a hunk can be taken from */
export type HunkSide = "left" | "right";

/** Where one side of a hunk stands */
export type SideState = "pending" | "taken" | "dismissed";

/** A hunk's colour in one pane, by `mergeHunkVariants`' names */
export type HunkLook = "conflict" | "resolved" | "dismissed";

/** A line's colour in one pane: a hunk's, or one side's own change */
export type LineLook = HunkLook | "changed";

/** Lines per pane */
type Counts = Record<MergePane, number>;

/**
 * A run of lines of the file, in the three panes at once.
 *
 * - `settled`: the same in every pane once merged. The result's copy can be
 *   edited, so its count may drift from the sides'. `changes` are the lines
 *   in it that a side changed on its own, as `merge3` found them.
 * - `hunk`: lines both devices changed differently. `left` and `right` are
 *   where each side stands; `edited` is the user typing into the hunk's lines
 *   in the result, which answers it whatever the sides say.
 */
export type Segment =
  | { kind: "settled"; lines: Counts; changes: SettledChange[] }
  | {
      kind: "hunk";
      lines: Counts;
      base: string[];
      ours: string[];
      theirs: string[];
      left: SideState;
      right: SideState;
      edited: boolean;
    };

export type Hunk = Extract<Segment, { kind: "hunk" }>;

/** Replace `text[start, end)` with `text`, offsets into the result's text */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * What a take or a dismissal did to the file. `edit` is the change to the
 * result's text, or `null` when the decision changed where the hunk stands
 * but not a character: dismissing one side while the other is pending,
 * taking the side that deleted the file, or taking a side the result
 * already holds. Either way it is one step for undo.
 */
export interface Decision {
  edit: TextEdit | null;
}

/** A run of settled lines folded away, as line indices in each pane */
export interface Fold {
  /** Which fold it is, for `unfold`: one segment can hold several */
  key: string;
  /** The first hidden line in each pane, 0-based */
  start: Counts;
  count: number;
}

/** Where a file stood at one moment, for `restore` */
export interface MergeSnapshot {
  readonly lines: readonly string[];
  readonly segments: readonly Segment[];
}

/**
 * Lines one side changed on its own, at `offset` lines into a settled
 * segment, and the panes that mark them: that side's, and the result while
 * the run's result lines up with the sides. A `count` of 0 is a deletion,
 * just above the line at `offset`.
 */
export interface Change {
  segment: number;
  offset: number;
  count: number;
  panes: MergePane[];
}

/** Lines of context kept visible around a hunk or a change when folding */
export const FOLD_CONTEXT = 3;
/**
 * The fewest lines worth a fold. The context around every hunk and change is
 * kept apart from this; it only stops a fold whose control, most of a line
 * tall itself, would save next to no scrolling.
 */
const FOLD_MIN = 4;

/** The pane of the side that made a settled change */
const SIDE_PANES: Record<SettledChange["by"], MergePane[]> = {
  ours: ["left"],
  theirs: ["right"],
  both: ["left", "right"],
};

/**
 * A pane's lines, the file split on `\n` alone as `merge3` splits it, so a
 * join gives the text back byte for byte. No file is no lines.
 */
const linesOf = (text: string | undefined) =>
  text === undefined ? [] : text.split("\n");

/** The edit that turns `from` into `to`: their common ends left alone */
const editBetween = (from: string, to: string): TextEdit | null => {
  if (from === to) return null;
  let start = 0;
  const shorter = Math.min(from.length, to.length);
  while (start < shorter && from[start] === to[start]) start++;
  let tail = 0;
  while (
    tail < shorter - start &&
    from[from.length - 1 - tail] === to[to.length - 1 - tail]
  ) {
    tail++;
  }
  return {
    start,
    end: from.length - tail,
    text: to.slice(start, to.length - tail),
  };
};

/** What a hunk holds in the result, for where its sides stand */
const contentOf = (hunk: Hunk) => {
  if (hunk.left !== "taken" && hunk.right !== "taken") return hunk.base;
  // This device's lines always before the other's
  return [
    ...(hunk.left === "taken" ? hunk.ours : []),
    ...(hunk.right === "taken" ? hunk.theirs : []),
  ];
};

const LOOK: Record<SideState, HunkLook> = {
  pending: "conflict",
  taken: "resolved",
  dismissed: "dismissed",
};

/**
 * One conflicted file in the resolve view: the three panes' text, its hunks
 * and where each stands, and the result as the user is making it.
 *
 * Plain data over no editor, so the rules -- what taking a side writes, when
 * a hunk counts as answered, which lines a keystroke belongs to -- are tested
 * on their own; the Monaco controller only mirrors this into its models. The
 * result's text here is the truth: the controller hands every edit of the
 * user's to `userEdit`, and applies every `TextEdit` this returns.
 */
export class MergeFile {
  readonly conflict: FileConflict;
  readonly path: string;
  /** This device's lines, read-only */
  readonly left: string;
  /** The other device's lines, read-only */
  readonly right: string;
  /** Which side, if either, deleted the file */
  readonly deleted: { left: boolean; right: boolean };
  readonly segments: Segment[];
  private _lines: string[];
  /** The result as the view opened on it, before any answer */
  private readonly _initial: string;

  private constructor(conflict: FileConflict) {
    this.conflict = conflict;
    this.path = conflict.path;

    if (conflict.kind === "settled") {
      // Nothing to decide: what it merges to, the same in every pane. The
      // result stays editable, as for any file.
      const text = conflict.content ?? "";
      const n = text.split("\n").length;
      this.deleted = { left: false, right: false };
      this.segments = [
        {
          kind: "settled",
          lines: { left: n, result: n, right: n },
          changes: [],
        },
      ];
      this.left = text;
      this.right = text;
      this._lines = text.split("\n");
    } else if (conflict.kind === "lines") {
      this.deleted = { left: false, right: false };
      this.segments = conflict.chunks.map((chunk): Segment => {
        if (chunk.kind === "settled") {
          const n = chunk.lines.length;
          return {
            kind: "settled",
            lines: { left: n, result: n, right: n },
            changes: chunk.changes ?? [],
          };
        }
        return {
          kind: "hunk",
          lines: {
            left: chunk.ours.length,
            result: chunk.base.length,
            right: chunk.theirs.length,
          },
          base: chunk.base,
          ours: chunk.ours,
          theirs: chunk.theirs,
          left: "pending",
          right: "pending",
          edited: false,
        };
      });
      const { chunks } = conflict;
      /** A pane: the settled lines, and one side's lines of each conflict */
      const join = (
        pick: (chunk: Extract<Chunk, { kind: "conflict" }>) => string[]
      ) => chunks.flatMap((c) => (c.kind === "settled" ? c.lines : pick(c)));
      this.left = join((c) => c.ours).join("\n");
      this.right = join((c) => c.theirs).join("\n");
      this._lines = join((c) => c.base);
    } else {
      // No hunks to be had: the whole file is one, and the result starts as
      // this device's copy -- empty when this device deleted it
      const ours = linesOf(conflict.local);
      const theirs = linesOf(conflict.server);
      this.deleted = {
        left: conflict.local === undefined,
        right: conflict.server === undefined,
      };
      this.segments = [
        {
          kind: "hunk",
          lines: {
            left: ours.length,
            result: ours.length,
            right: theirs.length,
          },
          base: ours,
          ours,
          theirs,
          left: "pending",
          right: "pending",
          edited: false,
        },
      ];
      this.left = conflict.local ?? "";
      this.right = conflict.server ?? "";
      this._lines = [...ours];
    }
    this._initial = this.result;
  }

  static from(conflict: FileConflict) {
    return new MergeFile(conflict);
  }

  /** The result as it stands */
  get result() {
    return this._lines.join("\n");
  }

  get hunks(): Array<{ hunk: Hunk; segment: number; index: number }> {
    const found: Array<{ hunk: Hunk; segment: number; index: number }> = [];
    this.segments.forEach((segment, i) => {
      if (segment.kind === "hunk") {
        found.push({ hunk: segment, segment: i, index: found.length });
      }
    });
    return found;
  }

  static isResolved(hunk: Hunk) {
    return hunk.edited || (hunk.left !== "pending" && hunk.right !== "pending");
  }

  /** Hunks with a side still to decide */
  get unresolved() {
    return this.hunks.filter(({ hunk }) => !MergeFile.isResolved(hunk)).length;
  }

  /**
   * Whether closing now would lose something the user did: a side taken or
   * dismissed (which may change no text), or the result typed into. Undoing
   * everything back to the start counts as nothing done.
   */
  get touched() {
    return (
      this.result !== this._initial ||
      this.hunks.some(
        ({ hunk }) =>
          hunk.edited || hunk.left !== "pending" || hunk.right !== "pending"
      )
    );
  }

  /** The first line of each segment in a pane, 0-based, and the line count */
  starts(pane: MergePane) {
    const starts: number[] = [];
    let at = 0;
    for (const segment of this.segments) {
      starts.push(at);
      at += segment.lines[pane];
    }
    return { starts, total: at };
  }

  /** A hunk's colour in a pane */
  look(hunk: Hunk, pane: MergePane): HunkLook {
    if (pane === "result") {
      return MergeFile.isResolved(hunk) ? "resolved" : "conflict";
    }
    const side = hunk[pane];
    // Typed over: a side never taken is left out of what was typed
    if (hunk.edited && side === "pending") return "dismissed";
    return LOOK[side];
  }

  /**
   * The lines each side changed on its own, and where they are marked. Once
   * the result of their run is edited out of line with the sides, the result
   * no longer marks them: which of its lines they are is no longer known.
   */
  changes(): Change[] {
    const found: Change[] = [];
    this.segments.forEach((segment, i) => {
      if (segment.kind !== "settled") return;
      const aligned = MergeFile._aligned(segment);
      for (const { start, count, by } of segment.changes) {
        found.push({
          segment: i,
          offset: start,
          count,
          panes: aligned ? [...SIDE_PANES[by], "result"] : SIDE_PANES[by],
        });
      }
    });
    return found;
  }

  /**
   * Take one side's lines into the result, after this device's when both
   * are taken.
   *
   * In a file without hunks (`whole`: no copy both agreed on, or a side
   * that deleted it), the answer is one of two files, not lines to add to
   * each other: taking either side leaves the other out.
   *
   * @returns what changed, or `null` when nothing did -- the side was
   * decided already, or the hunk typed over
   */
  take(index: number, side: HunkSide): Decision | null {
    const hunk = this._pending(index, side);
    if (!hunk) return null;
    hunk[side] = "taken";
    if (this.conflict.kind === "whole") {
      const other: HunkSide = side === "left" ? "right" : "left";
      hunk[other] = "dismissed";
    }
    return this._rewrite(hunk);
  }

  /** Leave one side's lines out of the result; returns as `take` does */
  dismiss(index: number, side: HunkSide): Decision | null {
    const hunk = this._pending(index, side);
    if (!hunk) return null;
    hunk[side] = "dismissed";
    return this._rewrite(hunk);
  }

  /**
   * Take the user's own edit of the result.
   *
   * Lines are matched by a line diff of the old text against the new, so a
   * change lands in the run it was made in however the editor reported it. A
   * change that replaces any of a hunk's lines in the result, or inserts
   * lines at its edges, answers the hunk (`edited`), and the lines it adds
   * are the hunk's; elsewhere they are the settled run's they were typed
   * into. Replacing the line next to a hunk leaves the hunk open.
   */
  userEdit(text: string) {
    if (text === this.result) return;
    const next = text.split("\n");
    const { starts, total } = this.starts("result");
    const ends = this.segments.map((s, i) => starts[i] + s.lines.result);
    const delta = this.segments.map(() => 0);

    /**
     * Whether old lines `[a, b)` replaced by new ones touch the hunk at `i`.
     * Ranges are half-open, so a replacement touches only lines it shares
     * with the hunk -- the line just above or below is the settled run's,
     * and answering the hunk for it would leave the base's lines in the
     * result as the answer. A replacement that spans a hunk of no lines
     * removes lines on both sides of where it is, and touches it. A pure
     * insertion, which removes nothing, touches a hunk it lands at either
     * edge of: lines typed right after or before it are taken as its own.
     */
    const touches = (i: number, a: number, b: number) =>
      a === b ? a >= starts[i] && a <= ends[i] : a < ends[i] && b > starts[i];

    /** Old lines `[a, b)` became `added` new ones */
    const change = (a: number, b: number, added: number) => {
      let target = -1;
      this.segments.forEach((segment, i) => {
        // Lines removed from each run they were in
        delta[i] -= Math.max(0, Math.min(b, ends[i]) - Math.max(a, starts[i]));
        if (segment.kind === "hunk" && touches(i, a, b)) {
          segment.edited = true;
          if (target < 0) target = i;
        }
      });
      if (target < 0) {
        // The settled run the change starts in; at the very end, the last
        target = this.segments.findIndex(
          (_, i) => a >= starts[i] && a < ends[i]
        );
        if (target < 0) target = this.segments.length - 1;
      }
      delta[target] += added;
    };

    let at = 0;
    let open: { a: number; b: number; added: number } | null = null;
    for (const part of diffArrays(this._lines, next)) {
      const n = part.value.length;
      if (!part.added && !part.removed) {
        if (open) change(open.a, open.b, open.added);
        open = null;
        at += n;
        continue;
      }
      open ??= { a: at, b: at, added: 0 };
      if (part.removed) {
        at += n;
        open.b = at;
      } else {
        open.added += n;
      }
    }
    if (open) change(open.a, open.b, open.added);

    this.segments.forEach((segment, i) => {
      segment.lines.result += delta[i];
    });
    this._lines = next;
    // An empty text is one empty line to the editor and none to a deleted
    // file; whichever it is, the counts must add up to what is there
    const drift = next.length - (total + delta.reduce((x, y) => x + y, 0));
    if (drift) this.segments[this.segments.length - 1].lines.result += drift;
  }

  /**
   * Runs of settled lines to fold away, with `FOLD_CONTEXT` lines kept next
   * to each hunk and around each change a side made on its own. The file's
   * last line is never folded: Monaco shows a view zone only when the line
   * after it is visible, and the fold's control is one. A run whose result
   * was edited is left whole, since its lines no longer line up across the
   * panes.
   */
  folds(): Fold[] {
    const panes = (["left", "result", "right"] as const).map((pane) => [
      pane,
      this.starts(pane).starts,
    ]) as Array<[MergePane, number[]]>;
    const last = this.segments.length - 1;
    const folds: Fold[] = [];
    this.segments.forEach((segment, i) => {
      if (segment.kind !== "settled" || !MergeFile._aligned(segment)) return;
      const n = segment.lines.result;
      /** Lines kept in view, as `[from, to)` within the run */
      const kept: Array<[number, number]> = [];
      if (i > 0) kept.push([0, FOLD_CONTEXT]);
      kept.push(i === last ? [n - 1, n] : [n - FOLD_CONTEXT, n]);
      for (const { start, count } of segment.changes) {
        kept.push([start - FOLD_CONTEXT, start + count + FOLD_CONTEXT]);
      }
      kept.sort((x, y) => x[0] - y[0]);

      let from = 0;
      const fold = (to: number) => {
        if (to - from < FOLD_MIN) return;
        const start = Object.fromEntries(
          panes.map(([pane, starts]) => [pane, starts[i] + from])
        ) as Counts;
        folds.push({ key: `${i}:${from}`, start, count: to - from });
      };
      for (const [a, b] of kept) {
        fold(Math.min(a, n));
        from = Math.max(from, b);
      }
    });
    return folds;
  }

  /**
   * The answer for this file: the result, pinned to the two copies the view
   * was shown. `content: null` deletes the file -- see `_deletes`.
   */
  resolved(): ResolvedFiles[string] {
    const { conflict } = this;
    return {
      content: this._deletes() ? null : this.result,
      ...(conflict.localHash !== undefined
        ? { localHash: conflict.localHash }
        : {}),
      ...(conflict.serverHash !== undefined
        ? { serverHash: conflict.serverHash }
        : {}),
    };
  }

  /** Where the result and every hunk stand now */
  snapshot(): MergeSnapshot {
    return {
      lines: [...this._lines],
      segments: this.segments.map((s) => ({ ...s, lines: { ...s.lines } })),
    };
  }

  /**
   * Go back to a snapshot of this file, as the editor's undo goes back to
   * the text it was taken with. The segments stay the same objects, so a
   * hunk found before is the same hunk after.
   */
  restore(snapshot: MergeSnapshot) {
    this._lines = [...snapshot.lines];
    snapshot.segments.forEach((s, i) => {
      Object.assign(this.segments[i], { ...s, lines: { ...s.lines } });
    });
  }

  /**
   * Whether the answer is to delete the file, decided by what was chosen
   * rather than by the result being empty: an empty file is a file, and a
   * side may hold one.
   *
   * Only where a side deleted it, and only for an empty result: the deleting
   * side taken; neither side taken, the result still this device's copy as
   * it started, when that copy is the delete; or the result emptied by hand
   * from lines, or from this device's delete. Taking or keeping a side's
   * empty file keeps it.
   */
  private _deletes() {
    const { deleted } = this;
    // Merged away: shown as an empty file, and left deleted unless typed in
    if (this.conflict.kind === "settled") {
      return this.conflict.content === undefined && this.result === "";
    }
    if (this.conflict.kind !== "whole" || !(deleted.left || deleted.right)) {
      return false;
    }
    if (this.result !== "") return false;
    const hunk = this.segments[0] as Hunk;
    if (hunk.edited) return this._initial !== "" || deleted.left;
    if (hunk.left === "taken") return deleted.left;
    if (hunk.right === "taken") return deleted.right;
    return deleted.left;
  }

  /** Whether a settled run's result still lines up with the sides */
  private static _aligned(segment: Segment) {
    const { left, result, right } = segment.lines;
    return left === result && right === result;
  }

  /** The hunk, if this side of it is still to decide */
  private _pending(index: number, side: HunkSide) {
    const found = this.hunks[index]?.hunk;
    if (!found || found.edited || found[side] !== "pending") return null;
    return found;
  }

  /** Put the hunk's content for its sides into the result */
  private _rewrite(hunk: Hunk): Decision {
    const i = this.segments.indexOf(hunk);
    const start = this.starts("result").starts[i];
    const before = this.result;
    const content = contentOf(hunk);
    this._lines.splice(start, hunk.lines.result, ...content);
    hunk.lines.result = content.length;
    return { edit: editBetween(before, this.result) };
  }
}

/**
 * What identifies a conflicted file's question: the two copies it was read
 * from. A refresh with a different key is a new question about that file.
 */
export const conflictKey = (file: FileConflict) =>
  JSON.stringify([file.kind, file.localHash ?? null, file.serverHash ?? null]);

/** Every file's answer, keyed by path, for `PgProjectSync.resolve` */
export const resolvedFiles = (files: readonly MergeFile[]): ResolvedFiles =>
  Object.fromEntries(files.map((file) => [file.path, file.resolved()]));
