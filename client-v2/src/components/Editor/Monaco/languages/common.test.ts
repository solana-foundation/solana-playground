import { afterEach, describe, expect, it, vi } from "vitest";

const { monacoEditor } = vi.hoisted(() => {
  type Editor = {
    getModel: () => unknown;
    onDidChangeModel: (cb: () => unknown) => { dispose: () => void };
  };
  const created: ((editor: Editor) => unknown)[] = [];
  const state = { editors: [] as Editor[] };
  return {
    monacoEditor: {
      state,
      created,
      getEditors: () => state.editors,
      onDidCreateEditor: (cb: (editor: Editor) => unknown) => {
        created.push(cb);
        return { dispose: () => {} };
      },
    },
  };
});

vi.mock("monaco-editor", () => ({ editor: monacoEditor }));
// Only `PgCommon` is used; the barrel would load the settings, which need
// the build's globals
vi.mock("../../../../utils", async () => ({
  PgCommon: (await import("../../../../utils/common")).PgCommon,
}));

import { importTypes } from "./common";

const rustModel = () => ({
  uri: {},
  getLanguageId: () => "rust",
  onDidChangeContent: () => ({ dispose: () => {} }),
});

const editorWith = (model: unknown) => ({
  getModel: () => model,
  onDidChangeModel: () => ({ dispose: () => {} }),
});

describe("importTypes", () => {
  afterEach(() => {
    monacoEditor.state.editors = [];
    monacoEditor.created.length = 0;
  });

  // The last project deleted while a language started: Home shows, with no
  // editor, and the start threw "reading 'onDidChangeModel'" (HOO-2585)
  it("starts with no editor, and takes the one created later", async () => {
    const update = vi.fn();
    await expect(importTypes(update, "rust")).resolves.toBeDefined();
    expect(update).not.toHaveBeenCalled();

    const model = rustModel();
    await monacoEditor.created[0](editorWith(model));
    expect(update).toHaveBeenCalledWith(model);
  });

  it("updates the open editor's model at the start", async () => {
    const model = rustModel();
    monacoEditor.state.editors = [editorWith(model)];
    const update = vi.fn();
    await importTypes(update, "rust");
    expect(update).toHaveBeenCalledWith(model);
  });
});
