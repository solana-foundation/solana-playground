import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PgEditor } from "@/utils/editor";

const { editor } = vi.hoisted(() => {
  const node = document.createElement("div");
  let readOnly = false;
  const noDispose = () => ({ dispose: () => {} });
  return {
    editor: {
      node,
      get readOnly() {
        return readOnly;
      },
      getContainerDomNode: () => node,
      getOption: () => readOnly,
      updateOptions: (o: { readOnly?: boolean }) => {
        if (o.readOnly !== undefined) readOnly = o.readOnly;
      },
      model: undefined as unknown,
      getModel(): unknown {
        return this.model;
      },
      createDecorationsCollection: () => ({ clear: () => {} }),
      changeViewZones: () => {},
      onDidChangeModel: noDispose,
      onDidDispose: noDispose,
    },
  };
});

// The stage's editor is the only one, and it sits in the frame
vi.mock("monaco-editor", () => ({
  editor: {
    getEditors: () => [editor],
    onDidCreateEditor: () => ({ dispose: () => {} }),
    EditorOption: { readOnly: 0 },
  },
}));

import { NO_MARKS } from "../model/lines";
import { useEditorLines } from "./use-editor-lines";

// The editor component applies the shared state on every change, as
// `Monaco.tsx` does
const apply = () => editor.updateOptions({ readOnly: PgEditor.readOnly });
document.addEventListener(PgEditor.events.READ_ONLY, apply);

const frame = () => {
  const root = document.createElement("div");
  root.append(editor.node);
  return root;
};

describe("useEditorLines", () => {
  const holds: Array<{ dispose: () => void }> = [];
  afterEach(() => {
    holds.splice(0).forEach((hold) => hold.dispose());
    editor.model = undefined;
  });

  // Start in a tutorial re-opens the workspace under a live editor, and the
  // model the hook had read was disposed: reading its lines threw "Model is
  // disposed!" into the error screen (HOO-2585)
  it("draws nothing on a model already disposed", () => {
    const disposed = () => {
      throw new Error("Model is disposed!");
    };
    editor.model = {
      isDisposed: () => true,
      getLineCount: disposed,
      getLineContent: disposed,
    };
    expect(() =>
      renderHook(() =>
        useEditorLines({ root: frame(), marks: NO_MARKS, busy: false })
      )
    ).not.toThrow();
  });

  it("leaves the editor writable after an act that started under the phone's lock", () => {
    const root = frame();
    // The phone holds Code read only (`useLockedPreview`)
    const phone = PgEditor.holdReadOnly("preview");
    holds.push(phone);
    const { rerender } = renderHook(
      ({ busy }) => useEditorLines({ root, marks: NO_MARKS, busy }),
      { initialProps: { busy: true } }
    );
    // Widening the window lets the phone's lock go while the act runs
    phone.dispose();
    expect(editor.readOnly).toBe(true);
    // The act ends
    rerender({ busy: false });
    expect(editor.readOnly).toBe(false);
  });
});
