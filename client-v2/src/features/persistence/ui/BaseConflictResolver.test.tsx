// Monaco cannot run under jsdom, so the controller is replaced with one that
// draws nothing but the overlay nodes the hunk controls are portalled into.
// Everything the component decides -- which controls show, what a take does
// to the file, when Apply is enabled -- is the real code.
vi.mock("./merge-editor/controller", () => ({
  createMergeEditor: (
    file: import("./merge-editor/merge-file").MergeFile,
    _hosts: unknown,
    options: import("./merge-editor/controller").MergeEditorOptions
  ) => {
    // Kept for a test to read what the editor was made with
    (globalThis as { __mergeOptions?: unknown }).__mergeOptions = options;
    const overlay = () =>
      document.body.appendChild(document.createElement("div"));
    const overlays = { left: overlay(), result: overlay(), right: overlay() };
    return {
      layout: {
        overlays,
        hunks: file.hunks.map(({ index }) => ({
          index,
          top: { left: 0, result: 0, right: 0 },
        })),
        bands: { left: [], right: [] },
        folds: [],
        canFold: false,
      },
      onDidChangeLayout: () => ({ dispose: () => undefined }),
      // Kept for a test to play the user typing into the result
      onDidEditResult: (cb: (change: "typed" | "history") => void) => {
        (globalThis as { __typed?: () => void }).__typed = () => {
          file.userEdit(file.result.replace("\nb\n", "\ntyped\n"));
          cb("typed");
        };
        return { dispose: () => undefined };
      },
      decide: (
        index: number,
        side: "left" | "right",
        action: "take" | "dismiss"
      ) => !!file[action](index, side),
      update: () => undefined,
      unfold: () => undefined,
      // Kept for a test to read which hunks Next and Previous scrolled to
      reveal: (index: number) =>
        (globalThis as { __revealed?: number[] }).__revealed?.push(index),
      dispose: () => Object.values(overlays).forEach((node) => node.remove()),
    };
  },
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { BaseConflictResolver } from "./BaseConflictResolver";
import { merge3 } from "../model/merge";
import type { FileConflict } from "../model/merge";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A file whose one conflict is its middle line */
const conflictIn = (path: string): FileConflict => {
  const merged = merge3("a\nb\nc", "a\nmine\nc", "a\ntheirs\nc");
  if (merged.kind !== "conflict") throw new Error("expected a conflict");
  return {
    kind: "lines",
    path,
    chunks: merged.chunks,
    localHash: `${path}:local`,
    serverHash: `${path}:server`,
  };
};

const FILES = [conflictIn("src/lib.rs"), conflictIn("tests/index.test.ts")];

const button = (name: string) => {
  const found = Array.from(document.querySelectorAll("button")).filter(
    // A hunk's control is named by its tooltip; its label adds which hunk
    (b) =>
      (b.getAttribute("title") ??
        b.getAttribute("aria-label") ??
        b.textContent?.trim()) === name
  );
  expect(found).toHaveLength(1);
  return found[0];
};

const press = (name: string) => act(() => button(name).click());

describe("BaseConflictResolver", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onApply = vi.fn();
  const onCancel = vi.fn();
  const onHunkResolved = vi.fn();

  beforeEach(async () => {
    // jsdom has none; the pane tabs' thumb measures itself with one
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () =>
      root.render(
        <BaseConflictResolver
          files={FILES}
          onApply={onApply}
          onKeepLocal={vi.fn()}
          onTakeServer={vi.fn()}
          onCancel={onCancel}
          onHunkResolved={onHunkResolved}
        />
      )
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    delete (globalThis as { __mergeOptions?: unknown }).__mergeOptions;
  });

  it("makes the panes at Monaco's own size off a phone", () => {
    expect(
      (globalThis as { __mergeOptions?: { phone?: boolean } }).__mergeOptions
        ?.phone
    ).toBe(false);
  });

  it("makes the panes a step up on a phone, as the code editor is", async () => {
    act(() => root.unmount());
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: media === "(width < 768px)",
      media,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    root = createRoot(container);
    await act(async () =>
      root.render(
        <BaseConflictResolver
          files={FILES}
          onApply={onApply}
          onKeepLocal={vi.fn()}
          onTakeServer={vi.fn()}
          onCancel={onCancel}
          onHunkResolved={onHunkResolved}
        />
      )
    );
    expect(
      (globalThis as { __mergeOptions?: { phone?: boolean } }).__mergeOptions
        ?.phone
    ).toBe(true);
  });

  it("keeps Apply disabled until every hunk of every file is resolved", async () => {
    expect(document.body.textContent).toContain("src/lib.rs");
    expect(document.body.textContent).toContain("2 conflicts left");
    expect(button("Apply").disabled).toBe(true);

    // One side decided is not the hunk decided
    await press("Take this device's lines");
    expect(button("Apply").disabled).toBe(true);
    await press("Take the other device's lines");
    expect(document.body.textContent).toContain("1 conflict left");
    // The first file is done, the second is not
    expect(button("Apply").disabled).toBe(true);

    await press("Next file");
    expect(document.body.textContent).toContain("tests/index.test.ts");
    await press("Dismiss this device's lines");
    expect(button("Apply").disabled).toBe(true);
    await press("Take the other device's lines");
    expect(document.body.textContent).toContain("No conflicts left");
    expect(button("Apply").disabled).toBe(false);

    await press("Apply");
    expect(onApply).toHaveBeenCalledWith({
      "src/lib.rs": {
        content: "a\nmine\ntheirs\nc",
        localHash: "src/lib.rs:local",
        serverHash: "src/lib.rs:server",
      },
      "tests/index.test.ts": {
        content: "a\ntheirs\nc",
        localHash: "tests/index.test.ts:local",
        serverHash: "tests/index.test.ts:server",
      },
    });
  });

  /** Press Escape with focus on `target`, as the browser dispatches it */
  const escapeFrom = (target: Element) =>
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        })
      );
    });

  /** An editor's input, inside the view, as Monaco draws one */
  const editorInput = (widget?: string) => {
    const editor = document.createElement("div");
    editor.className = "monaco-editor";
    if (widget) {
      editor.appendChild(document.createElement("div")).className = widget;
    }
    const input = editor.appendChild(document.createElement("textarea"));
    document.querySelector('[data-slot="modal-content"]')!.appendChild(editor);
    return input;
  };

  it("leaves Escape to an editor whose suggest, find or hint widget is open", async () => {
    for (const widget of [
      "suggest-widget visible",
      "find-widget visible",
      "parameter-hints-widget visible",
    ]) {
      await escapeFrom(editorInput(widget));
    }

    expect(onCancel).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("closes on Escape in an editor with no widget open, as outside one", async () => {
    // A find widget drawn but closed is not open
    await escapeFrom(editorInput("find-widget"));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await escapeFrom(button("Apply"));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("takes the app's theme rather than forcing dark", () => {
    // `applyThemeMode` sets `.dark` on <html> for a dark theme only; a `.dark`
    // inside the view would switch its tokens dark under the Light theme too
    expect(
      document.querySelector('[role="dialog"] .dark, .dark[role="dialog"]')
    ).toBeNull();
  });

  it("stays open on a click outside it", async () => {
    const outside = document.querySelector('[data-slot="modal-overlay"]')!;
    // Radix starts listening for outside presses a task after it opens
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await act(async () => {
      outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onCancel).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("asks before closing once a choice is made, and Escape backs out", async () => {
    // A dismissal changes no text, and is still a choice to lose
    await press("Dismiss this device's lines");
    await press("Cancel");
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Discard your choices?");

    await press("Keep resolving");
    expect(document.body.textContent).not.toContain("Discard your choices?");

    await escapeFrom(button("Apply"));
    expect(document.body.textContent).toContain("Discard your choices?");
    await escapeFrom(button("Discard"));
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Discard your choices?");

    await press("Cancel");
    await press("Discard");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("steps Next and Previous from the hunk last shown or decided, wrapping", async () => {
    // Three conflicts, lines 2, 4 and 6, with a settled line between each
    const merged = merge3(
      "a\n1\nb\n2\nc\n3\nd",
      "a\n1 mine\nb\n2 mine\nc\n3 mine\nd",
      "a\n1 theirs\nb\n2 theirs\nc\n3 theirs\nd"
    );
    if (merged.kind !== "conflict") throw new Error("expected a conflict");
    const revealed: number[] = [];
    (globalThis as { __revealed?: number[] }).__revealed = revealed;
    await act(async () =>
      root.render(
        <BaseConflictResolver
          files={[
            {
              kind: "lines",
              path: "src/three.rs",
              chunks: merged.chunks,
              localHash: "local",
              serverHash: "server",
            },
          ]}
          onApply={onApply}
          onKeepLocal={vi.fn()}
          onTakeServer={vi.fn()}
          onCancel={onCancel}
        />
      )
    );

    for (let i = 0; i < 4; i++) await press("Next conflict");
    expect(revealed).toEqual([0, 1, 2, 0]);

    await press("Previous conflict");
    expect(revealed.at(-1)).toBe(2);

    // Deciding hunk 1 makes it the place to count from; it is no longer open.
    // Each side's gutter holds its own controls for the hunk.
    const takeBoth = (name: string) =>
      act(() =>
        Array.from(
          document.querySelectorAll<HTMLButtonElement>('[data-hunk="1"] button')
        )
          .find((b) => b.getAttribute("aria-label") === name)!
          .click()
      );
    // Each hunk's controls say which hunk they are for
    await takeBoth("Take this device's lines, conflict 2 of 3");
    await takeBoth("Take the other device's lines, conflict 2 of 3");
    await press("Next conflict");
    expect(revealed.at(-1)).toBe(2);
    await press("Next conflict");
    expect(revealed.at(-1)).toBe(0);
    await press("Next conflict");
    expect(revealed.at(-1)).toBe(2);
    delete (globalThis as { __revealed?: number[] }).__revealed;
  });

  it("puts each side's controls in the tab order where they show", () => {
    /** The slots of a side's pane body, in DOM order */
    const order = (side: "left" | "right") =>
      Array.from(
        document.querySelector(
          `[data-slot="merge-pane"][data-side="${side}"] [data-slot="merge-pane-body"]`
        )!.children
      ).map((child) => child.getAttribute("data-slot") ?? "editor");

    // Beside the ribbon: after this device's editor, before the other's
    expect(order("left")).toEqual(["editor", "merge-hunk-gutter"]);
    expect(order("right")).toEqual(["merge-hunk-gutter", "editor"]);
  });

  it("says which hunks a take, a dismissal or typing resolved, once each", async () => {
    await press("Dismiss this device's lines");
    expect(onHunkResolved).not.toHaveBeenCalled();
    await press("Take the other device's lines");
    expect(onHunkResolved).toHaveBeenLastCalledWith("take", "right");

    // The second file's hunk, typed over
    await press("Next file");
    await act(async () =>
      (globalThis as unknown as { __typed: () => void }).__typed()
    );
    expect(onHunkResolved).toHaveBeenLastCalledWith("edit", null);
    expect(onHunkResolved).toHaveBeenCalledTimes(2);
  });
});
