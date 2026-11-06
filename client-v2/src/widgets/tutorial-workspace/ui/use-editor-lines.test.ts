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
      getModel: () => undefined,
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
