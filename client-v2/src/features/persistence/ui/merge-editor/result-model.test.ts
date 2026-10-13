import { merge3 } from "../../model/merge";
import { MergeFile } from "./merge-file";
import { MergeResult } from "./result-model";
import { canPushUndoStep } from "./undo-step";
import type * as Monaco from "monaco-editor";

// Monaco's module graph is large: transformed cold, under the whole suite,
// importing it alone can take longer than the default 5s
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * Monaco's text model and undo stack, the real ones. The editor API alone:
 * the full `monaco-editor` entry loads contributions jsdom cannot run, and
 * nothing here needs an editor.
 */
const loadMonaco = async (): Promise<typeof Monaco> =>
  import(
    // No typings for the deep module
    "monaco-editor/esm/vs/editor/editor.api.js" as string
  );

/**
 * What the editor's Undo and Redo commands call. On the 0.37 text model, but
 * not in its typings.
 */
type WithHistory = { undo(): Promise<void>; redo(): Promise<void> };
const undo = (model: Monaco.editor.ITextModel) =>
  (model as unknown as WithHistory).undo();
const redo = (model: Monaco.editor.ITextModel) =>
  (model as unknown as WithHistory).redo();

let monaco: typeof Monaco;
let models: Monaco.editor.ITextModel[] = [];

beforeAll(async () => {
  monaco = await loadMonaco();
});

afterEach(() => {
  for (const model of models) model.dispose();
  models = [];
});

/** Both devices changed the middle line differently */
const conflict = () => {
  const merged = merge3("a\nb\nc", "a\nmine\nc", "a\ntheirs\nc");
  if (merged.kind !== "conflict") throw new Error("expected a conflict");
  return MergeFile.from({
    kind: "lines",
    path: "src/lib.rs",
    chunks: merged.chunks,
    localHash: "l",
    serverHash: "s",
  });
};

/** The result pane's model over `file`, bound as the controller binds it */
const bind = (file: MergeFile) => {
  const model = monaco.editor.createModel(
    file.result,
    undefined,
    monaco.Uri.from({ scheme: "pg-merge", path: `result/${models.length}` })
  );
  models.push(model);
  const changes: string[] = [];
  const result = new MergeResult(file, model, (change) => changes.push(change));
  return { model, result, changes, hunk: () => file.hunks[0].hunk };
};

describe("MergeResult undo", () => {
  it("undoes a take alone when a dismissal that changed no text came before it", async () => {
    const file = conflict();
    const { model, result, hunk } = bind(file);

    // Dismissing one side while the other is pending leaves the base's line
    expect(result.decide(0, "left", "dismiss")).toBe(true);
    expect(model.getValue()).toBe("a\nb\nc");
    expect(result.decide(0, "right", "take")).toBe(true);
    expect(model.getValue()).toBe("a\ntheirs\nc");
    expect(file.unresolved).toBe(0);

    await undo(model);

    // The take is back to decide; the dismissal stands
    expect(model.getValue()).toBe("a\nb\nc");
    expect(hunk().right).toBe("pending");
    expect(hunk().left).toBe("dismissed");
    expect(file.unresolved).toBe(1);

    await undo(model);
    expect(hunk().left).toBe("pending");

    await redo(model);
    expect(hunk().left).toBe("dismissed");
    expect(hunk().right).toBe("pending");
    await redo(model);
    expect(hunk().right).toBe("taken");
    expect(model.getValue()).toBe("a\ntheirs\nc");
  });

  it("undoes a take of the side that deleted the file, which changes no text", async () => {
    const file = MergeFile.from({
      kind: "whole",
      path: "src/old.rs",
      server: "edited there",
      serverHash: "s",
    });
    const { model, result, hunk, changes } = bind(file);

    result.decide(0, "left", "take");
    expect(file.unresolved).toBe(0);

    await undo(model);
    expect(hunk().left).toBe("pending");
    expect(hunk().right).toBe("pending");
    expect(file.unresolved).toBe(1);
    expect(changes).toEqual(["history"]);
  });

  it("keeps typing after a decision a step of its own", async () => {
    const file = conflict();
    const { model, result, hunk } = bind(file);

    result.decide(0, "left", "dismiss");
    model.pushEditOperations(
      [],
      [
        {
          range: new monaco.Range(1, 1, 1, 1),
          text: "typed ",
        },
      ],
      () => null
    );
    expect(model.getValue()).toBe("typed a\nb\nc");

    await undo(model);
    expect(model.getValue()).toBe("a\nb\nc");
    expect(hunk().left).toBe("dismissed");
    await undo(model);
    expect(hunk().left).toBe("pending");
  });

  it("keeps a take undoable, and each side's bytes for Apply, where line breaks mix", async () => {
    const file = MergeFile.from({
      kind: "whole",
      path: "src/lib.rs",
      local: "a\r\nb\nc",
      server: "x\r\ny\nz",
      localHash: "l",
      serverHash: "s",
    });
    const { model, result, hunk } = bind(file);

    result.decide(0, "right", "take");
    // The model holds one kind of break; the answer keeps the side's own
    expect(model.getValue()).toBe("x\ny\nz");
    expect(file.resolved().content).toBe("x\r\ny\nz");

    await undo(model);
    expect(hunk().right).toBe("pending");
    expect(file.result).toBe("a\r\nb\nc");
  });

  it("ignores an answer for a side already decided", () => {
    const file = conflict();
    const { model, result } = bind(file);
    result.decide(0, "left", "take");
    expect(result.decide(0, "left", "dismiss")).toBe(false);
    expect(model.getValue()).toBe("a\nmine\nc");
  });

  // The undo stack's service is not in Monaco's typings, so nothing else
  // notices if an upgrade drops it: a decision would quietly share a step
  // with the one before. This fails instead.
  it("finds the undo stack on the pinned Monaco's text model", () => {
    const file = conflict();
    const { model } = bind(file);
    expect(canPushUndoStep(model)).toBe(true);
  });
});
