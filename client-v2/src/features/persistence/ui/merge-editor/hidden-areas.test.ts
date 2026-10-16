import { canHideLines, setHiddenLines } from "./hidden-areas";

// Monaco's module graph is large: transformed cold, under the whole suite,
// importing it alone can take longer than the default 5s. Set here rather
// than as `it`'s third argument, which the dev server's type check (it reads
// `it` from @types/mocha) rejects.
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
    expect(canHideLines(Object.create(StandaloneEditor.prototype))).toBe(true);
  });
});
