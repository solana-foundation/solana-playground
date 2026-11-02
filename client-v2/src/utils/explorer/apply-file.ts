import { PgExplorer } from "./explorer";

/**
 * Write a whole file into the open workspace and into the editor at once.
 *
 * Writing alone is not enough: when a file is reopened, the editor reuses an
 * existing Monaco model if one exists for that path
 * (`components/Editor/Monaco/Monaco.tsx`), and that model still holds the old
 * text. So a write under the file the user is looking at would be saved
 * correctly and stay invisible until a reload, and the next autosave would
 * put the old text back. Setting the model's value also gives the user a
 * normal editor undo.
 *
 * Shared by the assistant's `write_file` tool and the tutorial conversation's
 * writes, which both put code under a live editor.
 *
 * @param path relative to the workspace, e.g. `src/lib.rs`
 * @param content the file's whole new content
 */
export const applyFile = async (path: string, content: string) => {
  const fullPath = PgExplorer.convertToFullPath(path);

  // Write without touching tabs; the editor is synced separately below
  await PgExplorer.createItem(fullPath, content, {
    override: true,
    openOptions: { dontOpen: true },
  });

  const monaco = await import("monaco-editor");
  const model = monaco.editor.getModels().find((m) => m.uri.path === fullPath);
  if (model && model.getValue() !== content) model.setValue(content);
};
