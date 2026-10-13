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
