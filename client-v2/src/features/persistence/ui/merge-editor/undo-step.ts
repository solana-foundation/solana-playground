import type * as monaco from "monaco-editor";

/**
 * The resolve view's other reach past Monaco's typings (`hidden-areas.ts` is
 * the first).
 *
 * A take or a dismissal that changes where a hunk stands but no text is
 * still one step of undo: the user pressed something, and undo should take
 * that back alone. An edit cannot carry it -- Monaco drops an edit that
 * changes nothing, and its undo then fires no content event to restore the
 * hunk from -- so the step goes straight onto the model's undo stack, as an
 * element of its own whose undo and redo put the hunk back.
 *
 * The 0.37 text model keeps that stack's service as `_undoRedoService`,
 * which its `.d.ts` does not declare. A later Monaco may rename it, so it is
 * reached through this local type and nowhere else, and a missing service
 * means the step is not pushed rather than an error: the decision then
 * shares an undo step with the edit before it, as it did before.
 * `result-model.test.ts` fails if the pinned version loses it: it checks
 * the service is found, and undoes a dismissal that changed no text on the
 * real text model.
 */
interface UndoRedoService {
  pushElement(element: {
    /** `UndoRedoElementType.Resource`: an element of one model's stack */
    type: 0;
    resource: monaco.Uri;
    label: string;
    code: string;
    undo(): void;
    redo(): void;
  }): void;
}

const serviceOf = (model: unknown): UndoRedoService | null => {
  const service = (model as { _undoRedoService?: Partial<UndoRedoService> })
    ?._undoRedoService;
  return typeof service?.pushElement === "function"
    ? (service as UndoRedoService)
    : null;
};

/** Whether this model can take a step with no text */
export const canPushUndoStep = (model: unknown) => !!serviceOf(model);

/**
 * Push one undo step that changes no text onto the model's undo stack.
 *
 * The typing before it is closed off first, so undo takes back this step
 * alone, and typing after it starts a step of its own.
 *
 * @returns whether the step was pushed; `false` when the model cannot take
 * one, and nothing was done
 */
export const pushUndoStep = (
  model: monaco.editor.ITextModel,
  step: { label: string; undo: () => void; redo: () => void }
): boolean => {
  const service = serviceOf(model);
  if (!service) return false;
  model.pushStackElement();
  service.pushElement({
    type: 0,
    resource: model.uri,
    label: step.label,
    code: "pg-merge.decision",
    // A returned value would be taken for a promise: these return nothing
    undo: () => {
      step.undo();
    },
    redo: () => {
      step.redo();
    },
  });
  return true;
};
