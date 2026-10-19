import type * as monaco from "monaco-editor";

import { pushUndoStep } from "./undo-step";
import type {
  HunkSide,
  MergeFile,
  MergeSnapshot,
  TextEdit,
} from "./merge-file";

/**
 * A text as a Monaco model holds it: every line break, `\r\n`, `\n` or a
 * lone `\r`, as the model's one kind.
 */
const asModelHolds = (text: string, eol: string) =>
  text.replace(/\r\n|\r|\n/g, eol);

/** What the user can do to one side of a hunk */
export type HunkAction = "take" | "dismiss";

/** Why the result changed: the user typed, or undo or redo moved it */
export type ResultChange = "typed" | "history";

/**
 * The result pane's model, kept in step with the file's state.
 *
 * The file's text is the truth. Every take and dismissal goes through
 * `decide`, which writes its edit into the model as one step of undo; every
 * keystroke the user makes is handed to `MergeFile.userEdit`. Undo and redo
 * return the text to a version seen before, and the hunks go back with it:
 * the file's state is kept for each version of the result
 * (`getAlternativeVersionId`), and a decision that changes no text is an
 * undo step of its own (`pushUndoStep`) that puts the hunks back itself.
 *
 * Plain TypeScript over a text model and no editor, so it is tested against
 * Monaco's own model and undo stack.
 */
export class MergeResult {
  private readonly _file: MergeFile;
  private readonly _model: monaco.editor.ITextModel;
  private readonly _onChange: (change: ResultChange) => void;
  /** The file's state at each version of the result, for undo and redo */
  private readonly _history = new Map<number, MergeSnapshot>();
  /** Set while this writes to the model, so its own edit is not the user's */
  private _applying = false;
  private readonly _subscription: monaco.IDisposable;

  /**
   * @param onChange the result changed other than through `decide`: the
   * user typed, or undo or redo moved it
   */
  constructor(
    file: MergeFile,
    model: monaco.editor.ITextModel,
    onChange: (change: ResultChange) => void
  ) {
    this._file = file;
    this._model = model;
    this._onChange = onChange;
    this._record();
    this._subscription = model.onDidChangeContent((e) => {
      if (this._applying) return;
      // Undo and redo return the text to a version seen before; the hunks
      // go back with it, or an undone take would read as typing over the
      // hunk and answer it
      const seen =
        e.isUndoing || e.isRedoing
          ? this._history.get(model.getAlternativeVersionId())
          : undefined;
      if (seen && this._holds(seen.lines.join("\n"))) {
        this._file.restore(seen);
      } else {
        this._file.userEdit(model.getValue());
      }
      this._record();
      this._onChange(seen ? "history" : "typed");
    });
  }

  /**
   * Take or dismiss one side of a hunk, as one step of undo.
   *
   * @returns whether anything changed: `false` when the side was decided
   * already, or the hunk typed over
   */
  decide(index: number, side: HunkSide, action: HunkAction): boolean {
    const before = this._file.snapshot();
    const decision = this._file[action](index, side);
    if (!decision) return false;
    if (decision.edit) {
      this._write(decision.edit);
    } else {
      const after = this._file.snapshot();
      pushUndoStep(this._model, {
        label: action === "take" ? "Take lines" : "Dismiss lines",
        undo: () => this._restore(before),
        redo: () => this._restore(after),
      });
    }
    this._record();
    return true;
  }

  dispose() {
    this._subscription.dispose();
  }

  /** Mirror an edit the file made into the model, as a step of its own */
  private _write(edit: TextEdit) {
    const model = this._model;
    this._applying = true;
    try {
      const from = model.getPositionAt(edit.start);
      const to = model.getPositionAt(edit.end);
      // Never merged with the typing around it
      model.pushStackElement();
      model.pushEditOperations(
        [],
        [
          {
            range: {
              startLineNumber: from.lineNumber,
              startColumn: from.column,
              endLineNumber: to.lineNumber,
              endColumn: to.column,
            },
            text: edit.text,
          },
        ],
        () => null
      );
      model.pushStackElement();
      // The file's text is the truth, and the edit came from it, so the
      // model can only disagree by more than its own line breaks if the two
      // had drifted apart: then it is set whole, which costs the undo stack.
      // Line breaks alone are expected: the model holds one kind, and a
      // file whose copies mix them is asked about whole (`mixesLineBreaks`),
      // where the file keeps each side's bytes for Apply.
      if (!this._holds(this._file.result)) {
        model.setValue(this._file.result);
      }
    } finally {
      this._applying = false;
    }
  }

  /** Whether the model holds `text`, line breaks as it writes them */
  private _holds(text: string) {
    const model = this._model;
    return model.getValue() === asModelHolds(text, model.getEOL());
  }

  /** Undo or redo of a decision that changed no text */
  private _restore(snapshot: MergeSnapshot) {
    this._file.restore(snapshot);
    this._record();
    this._onChange("history");
  }

  /** Keep the file's state under the result's current version */
  private _record() {
    this._history.set(
      this._model.getAlternativeVersionId(),
      this._file.snapshot()
    );
  }
}

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeAll, afterEach } = import.meta.vitest;
  describe("features/persistence/ui/merge-editor/result-model", () => {
    let merge3: typeof import("../../model/merge").merge3;
    let MergeFile: typeof import("./merge-file").MergeFile;
    let canPushUndoStep: typeof import("./undo-step").canPushUndoStep;
    beforeAll(async () => {
      ({ merge3 } = await import("../../model/merge"));
      ({ MergeFile } = await import("./merge-file"));
      ({ canPushUndoStep } = await import("./undo-step"));
    });
    // Monaco's module graph is large: transformed cold, under the whole suite,
    // importing it alone can take longer than the default 5s
    vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

    /**
     * Monaco's text model and undo stack, the real ones. The editor API alone:
     * the full `monaco-editor` entry loads contributions jsdom cannot run, and
     * nothing here needs an editor.
     */
    const loadMonaco = async (): Promise<typeof import("monaco-editor")> =>
      import(
        // No typings for the deep module
        "monaco-editor/esm/vs/editor/editor.api.js" as string
      );

    /**
     * What the editor's Undo and Redo commands call. On the 0.37 text model, but
     * not in its typings.
     */
    type WithHistory = { undo(): Promise<void>; redo(): Promise<void> };
    const undo = (model: import("monaco-editor").editor.ITextModel) =>
      (model as unknown as WithHistory).undo();
    const redo = (model: import("monaco-editor").editor.ITextModel) =>
      (model as unknown as WithHistory).redo();

    let monaco: typeof import("monaco-editor");
    let models: import("monaco-editor").editor.ITextModel[] = [];

    beforeAll(async () => {
      monaco = await loadMonaco();
    });

    afterEach(() => {
      for (const model of models) model.dispose();
      models = [];
    });

    /** Both devices changed the middle line differently */
    const conflict = () => {
      const merged = merge3("a\nb\nc", "a\nmine\nc", "a\ntheirs\nc");
      if (merged.kind !== "conflict") throw new Error("expected a conflict");
      return MergeFile.from({
        kind: "lines",
        path: "src/lib.rs",
        chunks: merged.chunks,
        localHash: "l",
        serverHash: "s",
      });
    };

    /** The result pane's model over `file`, bound as the controller binds it */
    const bind = (file: MergeFile) => {
      const model = monaco.editor.createModel(
        file.result,
        undefined,
        monaco.Uri.from({ scheme: "pg-merge", path: `result/${models.length}` })
      );
      models.push(model);
      const changes: string[] = [];
      const result = new MergeResult(file, model, (change) =>
        changes.push(change)
      );
      return { model, result, changes, hunk: () => file.hunks[0].hunk };
    };

    describe("MergeResult undo", () => {
      it("undoes a take alone when a dismissal that changed no text came before it", async () => {
        const file = conflict();
        const { model, result, hunk } = bind(file);

        // Dismissing one side while the other is pending leaves the base's line
        expect(result.decide(0, "left", "dismiss")).toBe(true);
        expect(model.getValue()).toBe("a\nb\nc");
        expect(result.decide(0, "right", "take")).toBe(true);
        expect(model.getValue()).toBe("a\ntheirs\nc");
        expect(file.unresolved).toBe(0);

        await undo(model);

        // The take is back to decide; the dismissal stands
        expect(model.getValue()).toBe("a\nb\nc");
        expect(hunk().right).toBe("pending");
        expect(hunk().left).toBe("dismissed");
        expect(file.unresolved).toBe(1);

        await undo(model);
        expect(hunk().left).toBe("pending");

        await redo(model);
        expect(hunk().left).toBe("dismissed");
        expect(hunk().right).toBe("pending");
        await redo(model);
        expect(hunk().right).toBe("taken");
        expect(model.getValue()).toBe("a\ntheirs\nc");
      });

      it("undoes a take of the side that deleted the file, which changes no text", async () => {
        const file = MergeFile.from({
          kind: "whole",
          path: "src/old.rs",
          server: "edited there",
          serverHash: "s",
        });
        const { model, result, hunk, changes } = bind(file);

        result.decide(0, "left", "take");
        expect(file.unresolved).toBe(0);

        await undo(model);
        expect(hunk().left).toBe("pending");
        expect(hunk().right).toBe("pending");
        expect(file.unresolved).toBe(1);
        expect(changes).toEqual(["history"]);
      });

      it("keeps typing after a decision a step of its own", async () => {
        const file = conflict();
        const { model, result, hunk } = bind(file);

        result.decide(0, "left", "dismiss");
        model.pushEditOperations(
          [],
          [
            {
              range: new monaco.Range(1, 1, 1, 1),
              text: "typed ",
            },
          ],
          () => null
        );
        expect(model.getValue()).toBe("typed a\nb\nc");

        await undo(model);
        expect(model.getValue()).toBe("a\nb\nc");
        expect(hunk().left).toBe("dismissed");
        await undo(model);
        expect(hunk().left).toBe("pending");
      });

      it("keeps a take undoable, and each side's bytes for Apply, where line breaks mix", async () => {
        const file = MergeFile.from({
          kind: "whole",
          path: "src/lib.rs",
          local: "a\r\nb\nc",
          server: "x\r\ny\nz",
          localHash: "l",
          serverHash: "s",
        });
        const { model, result, hunk } = bind(file);

        result.decide(0, "right", "take");
        // The model holds one kind of break; the answer keeps the side's own
        expect(model.getValue()).toBe("x\ny\nz");
        expect(file.resolved().content).toBe("x\r\ny\nz");

        await undo(model);
        expect(hunk().right).toBe("pending");
        expect(file.result).toBe("a\r\nb\nc");
      });

      it("ignores an answer for a side already decided", () => {
        const file = conflict();
        const { model, result } = bind(file);
        result.decide(0, "left", "take");
        expect(result.decide(0, "left", "dismiss")).toBe(false);
        expect(model.getValue()).toBe("a\nmine\nc");
      });

      // The undo stack's service is not in Monaco's typings, so nothing else
      // notices if an upgrade drops it: a decision would quietly share a step
      // with the one before. This fails instead.
      it("finds the undo stack on the pinned Monaco's text model", () => {
        const file = conflict();
        const { model } = bind(file);
        expect(canPushUndoStep(model)).toBe(true);
      });
    });
  });
}
