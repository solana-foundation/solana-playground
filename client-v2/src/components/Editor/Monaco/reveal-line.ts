/** The part of Monaco's editor that scrolling to a line needs */
export interface RevealTarget {
  getLayoutInfo(): { height: number };
  getTopForLineNumber(line: number): number;
  setScrollTop(top: number): void;
  setPosition(position: { lineNumber: number; column: number }): void;
}

/**
 * Scroll so `line` sits a third of the way down the editor, never above the
 * top of the file, and put the caret at its start.
 *
 * @param editor the mounted editor
 * @param line 1-based; a missing or zero line moves nothing
 */
export const revealAtThird = (
  editor: RevealTarget,
  line: number | undefined
) => {
  if (!line) return;
  const third = editor.getLayoutInfo().height / 3;
  editor.setScrollTop(Math.max(0, editor.getTopForLineNumber(line) - third));
  editor.setPosition({ lineNumber: line, column: 1 });
};

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("components/Editor/Monaco/reveal-line", () => {
    /** An editor 600 px high whose lines are 20 px apart */
    const editor = () => ({
      getLayoutInfo: () => ({ height: 600 }),
      getTopForLineNumber: (line: number) => (line - 1) * 20,
      setScrollTop: vi.fn(),
      setPosition: vi.fn(),
    });

    it("puts the line a third of the way down, with the caret at its start", () => {
      const e = editor();
      revealAtThird(e, 31);
      expect(e.setScrollTop).toHaveBeenCalledWith(600 - 200);
      expect(e.setPosition).toHaveBeenCalledWith({ lineNumber: 31, column: 1 });
    });

    it("stops at the top of the file for a line near it", () => {
      const e = editor();
      revealAtThird(e, 1);
      expect(e.setScrollTop).toHaveBeenCalledWith(0);
    });

    it("moves nothing without a line", () => {
      const e = editor();
      revealAtThird(e, undefined);
      expect(e.setScrollTop).not.toHaveBeenCalled();
      expect(e.setPosition).not.toHaveBeenCalled();
    });
  });
}
