import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider,
  resetLogger,
} from "../../../shared/lib/logger";

import {
  applyReadOnly,
  executeProductEdits,
  READ_ONLY_MESSAGE,
} from "./read-only";
import { PgEditor } from "../../../utils/editor";
import { LAYOUT_BREAKPOINTS } from "../../../shared/lib/hooks/use-viewport";

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
  expect(logs.entries.filter((entry) => entry.level === "debug")).toHaveLength(
    0
  );
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
  expect(logs.entries.filter((entry) => entry.level === "error")).toHaveLength(
    1
  );
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
