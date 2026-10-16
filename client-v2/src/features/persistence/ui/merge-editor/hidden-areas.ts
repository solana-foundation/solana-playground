import type * as monaco from "monaco-editor";

/**
 * The one place the resolve view reaches past Monaco's typings.
 *
 * Folding unchanged lines needs `setHiddenAreas`, which the 0.37 editor has
 * (`CodeEditorWidget`) but its `.d.ts` does not declare: it is the call the
 * diff editor folds with, not public API. A later Monaco may rename or drop
 * it, so it is reached through this local type and nowhere else, and a
 * missing method means no folding rather than an error: the view then shows
 * every line and offers no "Show all lines" toggle.
 * `hidden-areas.test.ts` fails if the pinned version loses it.
 */
interface WithHiddenAreas {
  setHiddenAreas(ranges: monaco.IRange[]): void;
}

const hasHiddenAreas = (editor: unknown): editor is WithHiddenAreas =>
  typeof (editor as Partial<WithHiddenAreas> | null)?.setHiddenAreas ===
  "function";

/** Whether this editor can fold lines away */
export const canHideLines = (editor: unknown) => hasHiddenAreas(editor);

/**
 * Hide these line ranges, or show every line with `[]`.
 *
 * @returns whether the editor hid them; `false` when it cannot, in which case
 * every line stays shown
 */
export const setHiddenLines = (
  editor: unknown,
  ranges: monaco.IRange[]
): boolean => {
  if (!hasHiddenAreas(editor)) return false;
  editor.setHiddenAreas(ranges);
  return true;
};
