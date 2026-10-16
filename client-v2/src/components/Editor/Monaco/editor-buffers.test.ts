// Monaco's own text buffer and tracked-range tree, rather than a stand-in:
// where the caret ends up after an edit is decided by the tree's stickiness
// rules, and a stand-in that imitates them is exactly what let a caret turned
// into a selection pass. Required rather than imported: they ship no type
// declarations. They are ES modules, which Node 22's `require(esm)` loads.
import { editorBuffersOf } from "./editor-buffers";
import type { BufferModel } from "./editor-buffers";

const MONACO = "monaco-editor/esm/vs/editor/common";
const { Range } = require(`${MONACO}/core/range.js`);
const {
  IntervalNode,
  IntervalTree,
} = require(`${MONACO}/model/intervalTree.js`);
const {
  PieceTreeTextBufferBuilder,
} = require(`${MONACO}/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.js`);

/** A model with just enough of Monaco's surface to be read and disposed */
const modelAt = (path: string, text: string) => {
  const model = {
    uri: { path },
    getValue: () => text,
    getEOL: () => "\n",
    pushEditOperations: vi.fn(),
    pushStackElement: vi.fn(),
    dispose: vi.fn(),
  };
  return model as unknown as BufferModel & typeof model;
};

interface RawEdit {
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  text: string;
  forceMoveMarkers?: boolean;
}

/**
 * A model on Monaco's real text buffer, with the editor's selection tracked
 * the way `oneCursor.ts` tracks it: a range in the decorations tree with
 * `AlwaysGrowsWhenTypingAtEdges` stickiness. Edits reach the tree exactly as
 * `TextModel._doApplyEdits` hands them over, change by change.
 */
const monacoModel = (path: string, text: string) => {
  const builder = new PieceTreeTextBufferBuilder();
  builder.acceptChunk(text);
  const { textBuffer: buffer } = builder.finish(true).create(1 /* LF */);
  const tree = new IntervalTree();
  const selection = new IntervalNode("selection", 0, 0);
  selection.setOptions({
    stickiness: 0 /* AlwaysGrowsWhenTypingAtEdges */,
    collapseOnReplaceEdit: false,
  });
  tree.insert(selection);
  const calls: string[] = [];

  const model = {
    uri: { path },
    calls,
    getValue: () => buffer.getLinesContent().join(buffer.getEOL()),
    getEOL: () => buffer.getEOL(),
    getPositionAt: (offset: number) => buffer.getPositionAt(offset),
    pushStackElement: () => void calls.push("stack"),
    pushEditOperations: vi.fn((_before: unknown, edits: RawEdit[]) => {
      calls.push("edit");
      const result = buffer.applyEdits(
        edits.map((edit) => ({
          identifier: null,
          range: new Range(
            edit.range.startLineNumber,
            edit.range.startColumn,
            edit.range.endLineNumber,
            edit.range.endColumn
          ),
          text: edit.text,
          forceMoveMarkers: !!edit.forceMoveMarkers,
          isAutoWhitespaceEdit: false,
          _isTracked: false,
        })),
        false,
        true
      );
      for (const change of result.changes) {
        tree.acceptReplace(
          change.rangeOffset,
          change.rangeLength,
          change.text.length,
          change.forceMoveMarkers
        );
      }
      return null;
    }),
    dispose: vi.fn(),
    /** Put the caret here, collapsed */
    caretAt: (offset: number) => {
      tree.delete(selection);
      selection.reset(0, offset, offset, null);
      tree.insert(selection);
    },
    /** Where the selection is now, as offsets */
    selection: () => {
      tree.resolveNode(selection, 1);
      return [selection.cachedAbsoluteStart, selection.cachedAbsoluteEnd];
    },
  };
  return model as unknown as BufferModel & typeof model;
};

describe("editorBuffersOf", () => {
  it("reads the model the editor would reuse for a path", () => {
    const models = [modelAt("/p/src/lib.rs", "old")];
    const buffers = editorBuffersOf(() => models);

    expect(buffers.read("/p/src/lib.rs")).toBe("old");
    expect(buffers.read("/p/src/other.rs")).toBeUndefined();
  });

  it("replaces a model's text as undoable edits, in a step of their own", () => {
    // Not `setValue`, which would also throw away the undo stack. Fenced by
    // stack elements, so undoing does not take the user's own typing with it.
    const model = monacoModel("/p/src/lib.rs", "old");

    editorBuffersOf(() => [model]).write("/p/src/lib.rs", "new");

    expect(model.getValue()).toBe("new");
    expect(model.calls).toEqual(["stack", "edit", "stack"]);
  });

  it("keeps the caret where it was when the other device's lines are elsewhere", () => {
    // Sync folds what the user is typing into the other device's copy while
    // they type. Replacing the whole model left the caret at the end of the
    // file, so the next keystrokes landed there -- and were autosaved and
    // uploaded there.
    const before = "one\ntwo\nthree typing|\nfour\nfive\n";
    const after = "ONE\ntwo\nthree typing|\nfour\nFIVE\n";
    const model = monacoModel("/p/src/lib.rs", before);
    model.caretAt(before.indexOf("|"));

    editorBuffersOf(() => [model]).write("/p/src/lib.rs", after);

    expect(model.getValue()).toBe(after);
    expect(model.selection()).toEqual([after.indexOf("|"), after.indexOf("|")]);
    expect(model.pushEditOperations.mock.calls[0][1]).toHaveLength(2);
  });

  it("keeps the caret collapsed when the other device's lines go in right at it", () => {
    // The caret at the start of a line, and the other device's lines inserted
    // just above it: the edit ends exactly at the caret. Monaco grows a
    // selection tracked with `AlwaysGrowsWhenTypingAtEdges` over text inserted
    // at its edge, so the caret became a selection of their lines -- and the
    // next keystroke replaced them.
    const before = "one\ntwo\nthree\n";
    const after = "one\ntheirs\nmore\ntwo\nthree\n";
    const model = monacoModel("/p/src/lib.rs", before);
    model.caretAt(before.indexOf("two"));

    editorBuffersOf(() => [model]).write("/p/src/lib.rs", after);

    expect(model.getValue()).toBe(after);
    const at = after.indexOf("two");
    expect(model.selection()).toEqual([at, at]);
  });

  it("keeps the caret collapsed when a changed run of lines grows up to it", () => {
    const before = "one\ntwo\nthree\n";
    const after = "ONE\nextra\ntwo\nthree\n";
    const model = monacoModel("/p/src/lib.rs", before);
    model.caretAt(before.indexOf("two"));

    editorBuffersOf(() => [model]).write("/p/src/lib.rs", after);

    const at = after.indexOf("two");
    expect(model.selection()).toEqual([at, at]);
  });

  it("rewrites a file whose ends changed", () => {
    const model = monacoModel("/p/a", "a\nb\nc");
    const buffers = editorBuffersOf(() => [model]);

    buffers.write("/p/a", "a\nb\nc\n");
    expect(model.getValue()).toBe("a\nb\nc\n");
    buffers.write("/p/a", "x\nb\n");
    expect(model.getValue()).toBe("x\nb\n");
    buffers.write("/p/a", "");
    expect(model.getValue()).toBe("");
    buffers.write("/p/a", "new\nfile");
    expect(model.getValue()).toBe("new\nfile");
  });

  it("edits only what changed when the text's line breaks differ from the model's", () => {
    // Monaco rewrites every edit's line breaks to the model's own, so the
    // model keeps its CRLF whatever is written. Diffed as they came, every
    // line differed by its `\r` and each write replaced the whole file --
    // caret and all.
    const before = "one\r\ntwo typing|\r\nthree\r\n";
    const model = monacoModel("/p/a", before);
    model.caretAt(before.indexOf("|"));

    editorBuffersOf(() => [model]).write("/p/a", "one\ntwo typing|\nTHREE\n");

    const after = "one\r\ntwo typing|\r\nTHREE\r\n";
    expect(model.getValue()).toBe(after);
    const edits = model.pushEditOperations.mock.calls[0][1];
    expect(edits).toHaveLength(1);
    expect(edits[0].range).toMatchObject({
      startLineNumber: 3,
      endLineNumber: 4,
    });
    expect(model.selection()).toEqual([after.indexOf("|"), after.indexOf("|")]);
  });

  it("leaves a model that already holds the text alone", () => {
    // An edit fires the editor's change listener, and so an autosave
    const model = monacoModel("/p/src/lib.rs", "same\r\nlines");
    editorBuffersOf(() => [model]).write("/p/src/lib.rs", "same\nlines");

    expect(model.pushEditOperations).not.toHaveBeenCalled();
  });

  it("disposes the model of a file that is gone", () => {
    const model = modelAt("/p/src/gone.rs", "x");
    editorBuffersOf(() => [model]).discard("/p/src/gone.rs");

    expect(model.dispose).toHaveBeenCalled();
  });
});
