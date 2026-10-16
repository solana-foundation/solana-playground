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
 * The in-source tests of `hidden-areas.ts` fail if the pinned version loses it.
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

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  // Monaco's module graph is large: transformed cold, under the whole suite,
  // importing it alone can take longer than the default 5s. Kept as `vi.setConfig`
  // when the tests moved in-source; `it`'s timeout argument type-checks in a block.
  vi.setConfig({ testTimeout: 60_000 });

  const RANGE = {
    startLineNumber: 2,
    startColumn: 1,
    endLineNumber: 10,
    endColumn: 1,
  };

  describe("setHiddenLines", () => {
    it("hides through the editor's setHiddenAreas when it has one", () => {
      const editor = { setHiddenAreas: vi.fn() };
      expect(canHideLines(editor)).toBe(true);
      expect(setHiddenLines(editor, [RANGE])).toBe(true);
      expect(editor.setHiddenAreas).toHaveBeenCalledWith([RANGE]);
    });

    it("shows every line, without throwing, on an editor that lacks it", () => {
      const editor = { getModel: vi.fn() };
      expect(canHideLines(editor)).toBe(false);
      expect(setHiddenLines(editor, [RANGE])).toBe(false);
      expect(canHideLines(null)).toBe(false);
      expect(setHiddenLines(undefined, [RANGE])).toBe(false);
    });

    // `setHiddenAreas` is not in Monaco's typings, so nothing else notices if
    // an upgrade drops it: folding would just quietly stop. This fails instead.
    it("is still on the pinned Monaco's standalone editor", async () => {
      const { StandaloneEditor } = await import(
        // No typings for the deep module; the editor class is all that is read
        "monaco-editor/esm/vs/editor/standalone/browser/standaloneCodeEditor.js" as string
      );
      expect(typeof StandaloneEditor.prototype.setHiddenAreas).toBe("function");
      expect(canHideLines(Object.create(StandaloneEditor.prototype))).toBe(
        true
      );
    });
  });
}
