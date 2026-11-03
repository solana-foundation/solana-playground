import { useEffect, useState } from "react";
import * as monaco from "monaco-editor";

import { GHOST_TEXT, arrivalMs, decorationsFor } from "../model/lines";
import type { LineMarks } from "../model/lines";

/**
 * The stage's code editor inside `root`: Monaco's editors are global, and a
 * merge dialog or a diff opens others, so the one wanted is the one whose
 * node sits in the frame.
 */
const editorIn = (root: Element | null) =>
  root
    ? monaco.editor
        .getEditors()
        .find((e) => root.contains(e.getContainerDomNode())) ?? null
    : null;

/** The editor in `root`, kept up as Monaco creates and drops editors */
const useEditor = (root: Element | null) => {
  const [editor, setEditor] = useState(() => editorIn(root));
  useEffect(() => {
    setEditor(editorIn(root));
    // A new editor's node is placed in the page after the event: look again
    // once it is
    let frame = 0;
    const created = monaco.editor.onDidCreateEditor(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setEditor(editorIn(root)));
    });
    return () => {
      cancelAnimationFrame(frame);
      created.dispose();
    };
  }, [root]);
  useEffect(() => {
    if (!editor) return;
    const gone = editor.onDidDispose(() => setEditor(editorIn(root)));
    return () => gone.dispose();
  }, [editor, root]);
  return editor;
};

export interface EditorLines {
  /** What contains the stage's editor: the frame */
  root: Element | null;
  marks: LineMarks;
  /** An act runs: the code is dimmed and read only */
  busy: boolean;
}

/**
 * Draws the line states on the stage's Monaco editor (`model/lines.ts`):
 * decorations for the lines, a view zone for a ghost past the end, and a
 * read-only dimmed editor while an act runs. Written lines arrive once:
 * after the last one has settled the arrival classes come off, so a line
 * Monaco draws again on scroll does not flash again.
 */
export const useEditorLines = ({ root, marks, busy }: EditorLines) => {
  const editor = useEditor(root);
  const [settled, setSettled] = useState(false);
  const writtenKey = marks.written.join(",");
  const [model, setModel] = useState(() => editor?.getModel() ?? null);

  useEffect(() => {
    setModel(editor?.getModel() ?? null);
    if (!editor) return;
    const changed = editor.onDidChangeModel(() => setModel(editor.getModel()));
    return () => changed.dispose();
  }, [editor]);

  // A new block arrives once, then rests
  useEffect(() => {
    setSettled(false);
    if (!marks.arriving || marks.written.length === 0) return;
    const t = window.setTimeout(
      () => setSettled(true),
      arrivalMs(marks.written.length)
    );
    return () => window.clearTimeout(t);
  }, [writtenKey, marks.arriving, marks.written.length]);

  const { written, landing, error } = marks;
  // The marks are compared by content, not identity
  const landingKey = JSON.stringify(landing);
  const errorKey = JSON.stringify(error);
  const arriving = marks.arriving && !settled;

  useEffect(() => {
    if (!editor || !model) return;
    const plan = decorationsFor(
      { written, arriving, landing, error },
      model.getLineCount(),
      (n) => model.getLineContent(n)
    );
    const collection = editor.createDecorationsCollection(plan.decorations);
    let zone: string | null = null;
    if (plan.zoneAfter !== null) {
      const node = document.createElement("div");
      node.className = "pg-landing-zone";
      node.setAttribute("aria-hidden", "true");
      node.textContent = GHOST_TEXT;
      editor.changeViewZones((zones) => {
        zone = zones.addZone({
          afterLineNumber: plan.zoneAfter ?? 0,
          heightInLines: 1,
          domNode: node,
        });
      });
    }
    return () => {
      collection.clear();
      if (zone !== null) {
        const id = zone;
        editor.changeViewZones((zones) => zones.removeZone(id));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the keys stand for the marks
  }, [editor, model, writtenKey, arriving, landingKey, errorKey]);

  // Busy: read only and dimmed, and back as it was once the act is done
  useEffect(() => {
    if (!editor || !busy) return;
    const node = editor.getContainerDomNode();
    const wasReadOnly = editor.getOption(monaco.editor.EditorOption.readOnly);
    editor.updateOptions({ readOnly: true });
    node.classList.add("pg-editor-busy");
    return () => {
      node.classList.remove("pg-editor-busy");
      editor.updateOptions({ readOnly: wasReadOnly });
    };
  }, [editor, busy]);
};
