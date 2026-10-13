import type * as monaco from "monaco-editor";

import { LAYOUT_BREAKPOINTS } from "../../../shared/lib/hooks/use-viewport";
import { createLogger } from "../../../shared/lib/logger";
import { PgEditor } from "../../../utils/editor";

const log = createLogger("editor:read-only");

/** Monaco's message controller; its built-in read-only text is replaced by ours */
const MESSAGE_CONTROLLER_ID = "editor.contrib.messageController";

/**
 * Monaco's built-in read-only listener. Contributions start lazily, so asking
 * for it here starts it, and its listener is then registered before ours and
 * runs first, leaving our message shown last.
 */
const BUILT_IN_READ_ONLY_ID = "editor.contrib.readOnlyMessageController";

/**
 * Not in monaco-editor's public typings (only the contribution id is), so the
 * one method used is declared here.
 */
interface MessageController {
  showMessage(message: string, position: monaco.IPosition): void;
}

/**
 * What was already reported, per editor: `applyReadOnly` runs again on every
 * viewport change and its listener on every keystroke, and a Monaco upgrade
 * that breaks one of these would otherwise send an entry each time
 */
const reported = new WeakMap<object, Set<string>>();
const reportOnce = (editor: object, key: string, report: () => void) => {
  const keys = reported.get(editor) ?? new Set<string>();
  reported.set(editor, keys);
  if (keys.has(key)) return;
  keys.add(key);
  report();
};

/** What a phone user sees on trying to type */
export const READ_ONLY_MESSAGE = `Editing works on screens ${LAYOUT_BREAKPOINTS.phone} px and wider`;

/** The parts of the editor's layout the anchor reads, declared structurally */
interface EditorLayout {
  getVisibleRanges(): { startLineNumber: number }[];
  getModel(): { getLineCount(): number } | null;
}

/**
 * The message is anchored two lines below the first visible line, not at the
 * cursor: the widget shows above its anchor, so a cursor on line 1 would put
 * it above the editor, under the tab bar. Two lines because the widget is
 * taller than one line of text. Capped at the last line.
 */
const anchorOf = (editor: EditorLayout): monaco.IPosition => {
  const first = editor.getVisibleRanges()[0]?.startLineNumber ?? 1;
  const lineCount = editor.getModel()?.getLineCount() ?? 1;
  return { lineNumber: Math.min(first + 2, lineCount), column: 1 };
};

/**
 * Sets the editor read-only or editable, and on each attempt to type while
 * read-only announces it as `PgEditor.events.READ_ONLY_EDIT` (so the layout
 * shell can count it) and shows `READ_ONLY_MESSAGE`.
 *
 * The message goes through Monaco's message controller because 0.37 has no
 * `readOnlyMessage` option. The returned disposable removes the listener; it
 * does not reset `readOnly`, which the next call sets.
 */
export const applyReadOnly = (
  editor: EditorLayout &
    Pick<
      monaco.editor.IStandaloneCodeEditor,
      "updateOptions" | "onDidAttemptReadOnlyEdit"
    > & {
      getContribution(id: string): monaco.editor.IEditorContribution | null;
    },
  { readOnly }: { readOnly: boolean }
): monaco.IDisposable => {
  editor.updateOptions({ readOnly });

  // Must come before our listener: see BUILT_IN_READ_ONLY_ID
  if (!editor.getContribution(BUILT_IN_READ_ONLY_ID)) {
    reportOnce(editor, "built-in", () =>
      log.warn(
        "Monaco's built-in read-only listener is missing; its text may show over ours",
        { report: true }
      )
    );
  }

  return editor.onDidAttemptReadOnlyEdit(() => {
    // First, so the count never depends on the message showing
    document.dispatchEvent(new CustomEvent(PgEditor.events.READ_ONLY_EDIT));

    const controller = editor.getContribution(
      MESSAGE_CONTROLLER_ID
    ) as Partial<MessageController> | null;
    if (typeof controller?.showMessage !== "function") {
      reportOnce(editor, "controller", () =>
        log.warn("Message controller is missing; read-only text not shown", {
          report: true,
        })
      );
      return;
    }
    // The anchor reads the editor's layout, so it is inside the `try` too
    let anchor: monaco.IPosition | undefined;
    try {
      anchor = anchorOf(editor);
      controller.showMessage(READ_ONLY_MESSAGE, anchor);
    } catch (error) {
      reportOnce(editor, "show-message", () =>
        log.error(error, {
          report: true,
          context: { anchor, viewportWidth: window.innerWidth },
        })
      );
    }
  });
};

/**
 * `executeEdits` for an edit the product makes, not the user's typing: a
 * format, the program id a build writes. Monaco refuses every edit to a
 * read-only editor and says so only by returning `false`, and below
 * `LAYOUT_BREAKPOINTS.phone` the editor is read-only only to keep a phone
 * keyboard from typing into it.
 *
 * @returns whether the edits were applied
 */
export const executeProductEdits = (
  editor: Pick<
    monaco.editor.IStandaloneCodeEditor,
    "executeEdits" | "getRawOptions" | "updateOptions"
  >,
  edits: monaco.editor.IIdentifiedSingleEditOperation[]
): boolean => {
  const readOnly = editor.getRawOptions().readOnly === true;
  if (readOnly) editor.updateOptions({ readOnly: false });
  try {
    return editor.executeEdits(null, edits);
  } finally {
    if (readOnly) editor.updateOptions({ readOnly: true });
  }
};
