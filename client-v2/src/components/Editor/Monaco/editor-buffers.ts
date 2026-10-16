import { diffArrays } from "diff";
import type * as monaco from "monaco-editor";

import type { EditorBuffers } from "../../../utils/explorer/types";

/** The part of a Monaco model the buffers need, so tests can stand one in */
export type BufferModel = Pick<
  monaco.editor.ITextModel,
  | "uri"
  | "getValue"
  | "getEOL"
  | "getPositionAt"
  | "pushEditOperations"
  | "pushStackElement"
  | "dispose"
>;

/** A text's lines, each with its own line break, so they join back exactly */
const linesOf = (text: string) => {
  // Not a lookbehind split: older Safari fails to parse one at all, which
  // takes the whole bundle down with it
  const lines = text.split("\n").map((line) => `${line}\n`);
  lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1);
  return lines;
};

/**
 * The edits that turn `from` into `to`, one per run of changed lines, as
 * offsets into `from`.
 *
 * Per change rather than one replace of the whole file, because Monaco moves
 * the caret to the end of any edit that covers it: a whole-file replace put
 * it at the end of the file. Sync rewrites a buffer while the user types --
 * folding their typing into the other device's copy -- so the next keystrokes
 * landed at the end, and were autosaved and uploaded there. An edit that
 * leaves the caret's line alone leaves the caret alone.
 */
const editsBetween = (from: string, to: string) => {
  const edits: Array<{ start: number; end: number; text: string }> = [];
  let at = 0;
  let open: { start: number; end: number; text: string } | null = null;

  for (const part of diffArrays(linesOf(from), linesOf(to))) {
    const length = part.value.join("").length;
    if (!part.added && !part.removed) {
      if (open) edits.push(open);
      open = null;
      at += length;
      continue;
    }
    open ??= { start: at, end: at, text: "" };
    if (part.removed) {
      at += length;
      open.end = at;
    } else {
      open.text += part.value.join("");
    }
  }
  if (open) edits.push(open);
  return edits;
};

/**
 * Monaco's models, as the explorer's `EditorBuffers`.
 *
 * Matched on `uri.path`, the same key the editor's own open-file handler uses
 * to decide whether a model exists already -- which is exactly the reuse that
 * made a rewritten file go on showing its old text.
 *
 * Kept apart from `Monaco.tsx`, and typed against a model's shape rather than
 * the library, so it can be tested without loading Monaco itself.
 */
export const editorBuffersOf = (
  getModels: () => BufferModel[]
): EditorBuffers => {
  const find = (path: string) =>
    getModels().find((model) => model.uri.path === path);

  return {
    read: (path) => find(path)?.getValue(),
    write: (path, content) => {
      const model = find(path);
      if (!model) return;
      const current = model.getValue();
      // In the model's own line breaks, which Monaco would rewrite any edit's
      // text to anyway. Diffed as they came, a file whose breaks differ from
      // the model's differed on every line, and each write replaced it whole.
      const eol = model.getEOL();
      const wanted = content.replace(/\r\n|\r|\n/g, eol);
      if (current === wanted) return;
      // Edits rather than `setValue`, so the user can still undo past them,
      // and so the editor's change listener -- autosave -- sees them and
      // writes the new text rather than a stale one. All in one call, with
      // every range read off the model before any is applied, as Monaco
      // expects of a batch -- and fenced into an undo step of its own, so
      // undoing the sync does not take the user's typing with it.
      //
      // `forceMoveMarkers`, because the editor tracks its selection with
      // `AlwaysGrowsWhenTypingAtEdges` stickiness: text inserted where the
      // caret sits -- the other device's lines, landing just above the line
      // being typed on -- otherwise grew the caret into a selection of them,
      // and the next keystroke replaced them.
      model.pushStackElement();
      model.pushEditOperations(
        [],
        editsBetween(current, wanted).map(({ start, end, text }) => {
          const from = model.getPositionAt(start);
          const to = model.getPositionAt(end);
          return {
            range: {
              startLineNumber: from.lineNumber,
              startColumn: from.column,
              endLineNumber: to.lineNumber,
              endColumn: to.column,
            },
            text,
            forceMoveMarkers: true,
          };
        }),
        () => null
      );
      model.pushStackElement();
    },
    discard: (path) => find(path)?.dispose(),
  };
};
