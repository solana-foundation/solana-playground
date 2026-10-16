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

if (import.meta.vitest) {
  const { it, expect, vi, beforeAll, beforeEach, afterEach } = import.meta
    .vitest;
  let initLogger: typeof import("../../../shared/lib/logger").initLogger;
  let memoryProvider: typeof import("../../../shared/lib/logger").memoryProvider;
  let resetLogger: typeof import("../../../shared/lib/logger").resetLogger;
  beforeAll(async () => {
    ({ initLogger, memoryProvider, resetLogger } = await import(
      "../../../shared/lib/logger"
    ));
  });
  const fakeEditor = ({
    hasMessageController = true,
    hasBuiltIn = true,
    messageController = undefined as unknown,
    firstVisibleLine = 1,
    lineCount = 50,
  } = {}) => {
    let attempt: () => void = () => {};
    const showMessage = vi.fn();
    const calls: string[] = [];
    return {
      calls,
      showMessage,
      updateOptions: vi.fn(),
      onDidAttemptReadOnlyEdit: vi.fn((fn: () => void) => {
        calls.push("onDidAttemptReadOnlyEdit");
        attempt = fn;
        return { dispose: vi.fn() };
      }),
      getContribution: vi.fn((id: string) => {
        calls.push(`getContribution:${id}`);
        if (id !== "editor.contrib.messageController")
          return hasBuiltIn ? { dispose: vi.fn() } : null;
        if (messageController !== undefined)
          return messageController as { dispose(): void };
        return hasMessageController ? { showMessage, dispose: vi.fn() } : null;
      }),
      getVisibleRanges: vi.fn(() => [
        {
          startLineNumber: firstVisibleLine,
          endLineNumber: firstVisibleLine + 20,
        },
      ]),
      getModel: vi.fn(() => ({ getLineCount: () => lineCount })),
      attempt: () => attempt(),
    };
  };

  const heard = vi.fn();
  let logs: ReturnType<typeof memoryProvider>;
  beforeEach(() => {
    logs = memoryProvider();
    initLogger({ providers: [logs] });
  });
  afterEach(() => {
    resetLogger();
    document.removeEventListener(PgEditor.events.READ_ONLY_EDIT, heard);
    heard.mockClear();
  });

  it("should make the editor read-only", () => {
    const editor = fakeEditor();
    applyReadOnly(editor, { readOnly: true });
    expect(editor.updateOptions).toHaveBeenCalledWith({ readOnly: true });
    expect(READ_ONLY_MESSAGE).toBe("Editing works on screens 600 px and wider");
  });

  it("should start Monaco's built-in read-only listener before subscribing", () => {
    const editor = fakeEditor();
    applyReadOnly(editor, { readOnly: true });
    expect(editor.calls).toEqual([
      "getContribution:editor.contrib.readOnlyMessageController",
      "onDidAttemptReadOnlyEdit",
    ]);
  });

  it("should show the message two lines below the first visible line", () => {
    const editor = fakeEditor({ firstVisibleLine: 10 });
    applyReadOnly(editor, { readOnly: true });
    editor.attempt();
    expect(editor.showMessage).toHaveBeenCalledWith(READ_ONLY_MESSAGE, {
      lineNumber: 12,
      column: 1,
    });
  });

  it("should cap the message at the last line", () => {
    const editor = fakeEditor({ firstVisibleLine: 50, lineCount: 50 });
    applyReadOnly(editor, { readOnly: true });
    editor.attempt();
    expect(editor.showMessage).toHaveBeenCalledWith(READ_ONLY_MESSAGE, {
      lineNumber: 50,
      column: 1,
    });
  });

  it("should anchor a one-line model at line 1", () => {
    const editor = fakeEditor({ firstVisibleLine: 1, lineCount: 1 });
    applyReadOnly(editor, { readOnly: true });
    editor.attempt();
    expect(editor.showMessage).toHaveBeenCalledWith(READ_ONLY_MESSAGE, {
      lineNumber: 1,
      column: 1,
    });
  });

  it("should announce an attempted edit as a document event", () => {
    const editor = fakeEditor();
    document.addEventListener(PgEditor.events.READ_ONLY_EDIT, heard);
    applyReadOnly(editor, { readOnly: true });
    editor.attempt();
    expect(heard).toHaveBeenCalledOnce();
  });

  it("should still announce an attempted edit without a message controller", () => {
    const editor = fakeEditor({ hasMessageController: false });
    document.addEventListener(PgEditor.events.READ_ONLY_EDIT, heard);
    applyReadOnly(editor, { readOnly: true });
    editor.attempt();
    expect(heard).toHaveBeenCalledOnce();
  });

  it("should make the editor editable again", () => {
    const editor = fakeEditor();
    applyReadOnly(editor, { readOnly: false });
    expect(editor.updateOptions).toHaveBeenCalledWith({ readOnly: false });
  });

  it("should build the message from the phone breakpoint", () => {
    expect(READ_ONLY_MESSAGE).toBe(
      `Editing works on screens ${LAYOUT_BREAKPOINTS.phone} px and wider`
    );
  });

  it("should return a disposable that removes the listener and leaves readOnly alone", () => {
    const removed = vi.fn();
    const editor = fakeEditor();
    editor.onDidAttemptReadOnlyEdit.mockImplementation(() => ({
      dispose: removed,
    }));
    const disposable = applyReadOnly(editor, { readOnly: true });
    disposable.dispose();
    expect(removed).toHaveBeenCalledOnce();
    expect(editor.updateOptions).toHaveBeenCalledTimes(1);
  });

  it("should warn once if Monaco's built-in read-only listener is missing", () => {
    const editor = fakeEditor({ hasBuiltIn: false });
    applyReadOnly(editor, { readOnly: true });
    editor.attempt();
    editor.attempt();
    const warns = logs.entries.filter((entry) => entry.level === "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0].message).toContain("built-in");
  });

  it("should warn once, not per keystroke, when the message controller is missing", () => {
    const editor = fakeEditor({ hasMessageController: false });
    applyReadOnly(editor, { readOnly: true });
    editor.attempt();
    editor.attempt();
    editor.attempt();
    expect(logs.entries.filter((entry) => entry.level === "warn")).toHaveLength(
      1
    );
    expect(
      logs.entries.filter((entry) => entry.level === "debug")
    ).toHaveLength(0);
  });

  it("should warn when the message controller has no showMessage", () => {
    const editor = fakeEditor({ messageController: { dispose: vi.fn() } });
    document.addEventListener(PgEditor.events.READ_ONLY_EDIT, heard);
    applyReadOnly(editor, { readOnly: true });
    editor.attempt();
    expect(heard).toHaveBeenCalledOnce();
    expect(logs.entries.filter((entry) => entry.level === "warn")).toHaveLength(
      1
    );
  });

  it("should report a showMessage that throws, and still announce the edit", () => {
    const boom = new Error("boom");
    const editor = fakeEditor({
      messageController: {
        showMessage: () => {
          throw boom;
        },
      },
    });
    document.addEventListener(PgEditor.events.READ_ONLY_EDIT, heard);
    applyReadOnly(editor, { readOnly: true });
    expect(() => editor.attempt()).not.toThrow();
    expect(heard).toHaveBeenCalledOnce();
    const errors = logs.entries.filter((entry) => entry.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBe(boom);
    expect(errors[0].report).toBe(true);
  });

  it("should announce the edit before it shows the message", () => {
    const order: string[] = [];
    const editor = fakeEditor();
    editor.showMessage.mockImplementation(() => order.push("message"));
    const onEdit = () => order.push("event");
    document.addEventListener(PgEditor.events.READ_ONLY_EDIT, onEdit);
    applyReadOnly(editor, { readOnly: true });
    editor.attempt();
    document.removeEventListener(PgEditor.events.READ_ONLY_EDIT, onEdit);
    expect(order).toEqual(["event", "message"]);
  });

  it("should report a showMessage that throws once per editor, not per keystroke", () => {
    const editor = fakeEditor({
      messageController: {
        showMessage: () => {
          throw new Error("boom");
        },
      },
    });
    applyReadOnly(editor, { readOnly: true });
    editor.attempt();
    editor.attempt();
    // A viewport change applies it again to the same editor
    applyReadOnly(editor, { readOnly: true });
    editor.attempt();
    expect(
      logs.entries.filter((entry) => entry.level === "error")
    ).toHaveLength(1);
  });

  it("should report a missing built-in listener once per editor, across viewport changes", () => {
    const editor = fakeEditor({ hasBuiltIn: false });
    applyReadOnly(editor, { readOnly: true });
    applyReadOnly(editor, { readOnly: false });
    applyReadOnly(editor, { readOnly: true });
    const warns = logs.entries.filter((entry) => entry.level === "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0].report).toBe(true);
  });

  /** An editor that applies an edit only while editable, as Monaco does */
  const editableEditor = (readOnly: boolean) => {
    const options = { readOnly };
    return {
      options,
      getRawOptions: () => options,
      updateOptions: vi.fn((next: { readOnly?: boolean }) => {
        if (next.readOnly !== undefined) options.readOnly = next.readOnly;
      }),
      executeEdits: vi.fn(() => !options.readOnly),
    };
  };

  it("should apply a product edit to a read-only editor and leave it read-only", () => {
    const editor = editableEditor(true);
    expect(executeProductEdits(editor, [])).toBe(true);
    expect(editor.options.readOnly).toBe(true);
  });

  it("should apply a product edit to an editable editor without touching readOnly", () => {
    const editor = editableEditor(false);
    expect(executeProductEdits(editor, [])).toBe(true);
    expect(editor.updateOptions).not.toHaveBeenCalled();
  });

  it("should leave the editor read-only when the edit throws", () => {
    const editor = editableEditor(true);
    editor.executeEdits.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => executeProductEdits(editor, [])).toThrow("boom");
    expect(editor.options.readOnly).toBe(true);
  });
}
