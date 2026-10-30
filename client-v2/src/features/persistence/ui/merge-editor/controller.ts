import * as monaco from "monaco-editor";

import { editorFont } from "@/shared/lib/editor-font";
import { mergeHunkVariants } from "@/shared/ui/merge";
import { canHideLines, setHiddenLines } from "./hidden-areas";
import { hunkLineClass } from "./hunk-class";
import type { MergeBand } from "@/shared/ui/merge";
import { MergeFile } from "./merge-file";
import { MergeResult } from "./result-model";
import type { Fold, HunkSide, MergePane } from "./merge-file";
import type { HunkAction, ResultChange } from "./result-model";
import { MERGE_SCHEME } from "./scheme";
import type { Disposable } from "../../../../utils/types";

/** A fold's height, as `MergeFold` draws it */
const FOLD_PX = 24;
/** A hunk bar's height, as `MergeHunkBar` draws it */
const BAR_PX = 44;

const PANES: readonly MergePane[] = ["left", "result", "right"];

/**
 * A pane's model's address: `pg-merge:left/src/lib.rs`.
 *
 * Its own scheme, so Monaco's registry never confuses it with the
 * explorer's `Uri.parse(path)` model of the same file. And no leading slash:
 * the explorer, `editor-buffers` and `PgEditorModels` find their models by
 * `uri.path` alone, and every explorer path starts with `/` -- so no lookup
 * of theirs can reach one of these, whatever a workspace is called.
 */
export const uriOf = (pane: MergePane, path: string) =>
  monaco.Uri.from({
    scheme: MERGE_SCHEME,
    path: `${pane}/${path.replace(/^\/+/, "")}`,
  });

/** Where the panes' editors go; a side that deleted the file has none */
export interface MergeHosts {
  left: HTMLElement | null;
  result: HTMLElement;
  right: HTMLElement | null;
}

export interface MergeEditorOptions {
  /** One pane at a time (phone width): no spacers, every control in Result */
  single: boolean;
  /** Every fold opened */
  showAll: boolean;
  fontFamily?: string;
  /** The phone layout: the code a step up, as in the code editor */
  phone?: boolean;
}

/** A hunk's top in each pane, in px from the top of the pane's body */
export interface HunkPlace {
  index: number;
  top: Record<MergePane, number | null>;
  /** One pane at a time: the top of the room kept under it for its bar */
  bar: number | null;
}

/** A fold, and where its control goes in each pane, in px from the top */
export interface FoldPlace {
  key: string;
  count: number;
  top: Record<MergePane, number | null>;
}

/** What the React side draws over and between the editors */
export interface MergeLayout {
  /** Nodes laid over each editor, for the hunk controls */
  overlays: Record<MergePane, HTMLElement | null>;
  hunks: HunkPlace[];
  bands: { left: MergeBand[]; right: MergeBand[] };
  folds: FoldPlace[];
  /** Whether lines can be folded at all -- see `hidden-areas.ts` */
  canFold: boolean;
}

/** The three editors of one file, kept aligned and scrolled together */
export interface MergeEditor {
  readonly layout: MergeLayout;
  /** Scrolled, resized or re-laid out: the overlays and ribbons move */
  onDidChangeLayout(cb: () => void): Disposable;
  /** The user typed into the result, or undid or redid; the file has it */
  onDidEditResult(cb: (change: ResultChange) => void): Disposable;
  /**
   * Take or dismiss one side of a hunk, into the result, as one step of
   * undo -- see `MergeResult.decide`
   */
  decide(index: number, side: HunkSide, action: HunkAction): boolean;
  update(options: Partial<MergeEditorOptions>): void;
  /** Open one fold, by its `key` */
  unfold(key: string): void;
  /** Scroll a hunk into view */
  reveal(hunk: number): void;
  dispose(): void;
}

export const createMergeEditor = (
  file: MergeFile,
  hosts: MergeHosts,
  options: MergeEditorOptions
): MergeEditor => new MonacoMergeEditor(file, hosts, options);

type Editors = Partial<Record<MergePane, monaco.editor.IStandaloneCodeEditor>>;

/** Stop Monaco's own mouse handling from reaching a control drawn over it */
const insulate = (node: HTMLElement) => {
  node.addEventListener("mousedown", (e) => e.stopPropagation());
  return node;
};

class MonacoMergeEditor implements MergeEditor {
  private readonly _file: MergeFile;
  private _options: MergeEditorOptions;
  private readonly _editors: Editors = {};
  private readonly _models: monaco.editor.ITextModel[] = [];
  private readonly _overlays: Record<MergePane, HTMLElement | null> = {
    left: null,
    result: null,
    right: null,
  };
  private readonly _decorations: Partial<Record<MergePane, string[]>> = {};
  private readonly _zones: Partial<Record<MergePane, string[]>> = {};
  private _zoneKey = "";
  private _folds: Fold[] = [];
  private readonly _opened = new Set<string>();
  private readonly _disposables: monaco.IDisposable[] = [];
  private readonly _layoutListeners = new Set<() => void>();
  private readonly _editListeners = new Set<(change: ResultChange) => void>();
  private readonly _result: MergeResult;
  private _syncing = false;
  private _frame: number | null = null;
  private _layout: MergeLayout;

  constructor(file: MergeFile, hosts: MergeHosts, options: MergeEditorOptions) {
    this._file = file;
    this._options = options;
    // A throw partway through (a second pane's editor failing to create)
    // would leave the first pane's model registered at its address, and
    // every editor made so far alive in its host, with nothing to dispose them
    try {
      this._result = this._build(hosts);
      this._layout = this._measure();
      this._refresh();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /** The panes' models and editors, and the result's model over them */
  private _build(hosts: MergeHosts): MergeResult {
    const file = this._file;
    const text: Record<MergePane, string> = {
      left: file.left,
      result: file.result,
      right: file.right,
    };
    for (const pane of PANES) {
      const host = hosts[pane];
      if (!host) continue;
      const uri = uriOf(pane, file.path);
      // Left over from a view that never closed cleanly: a second model at
      // the same address would throw
      monaco.editor.getModel(uri)?.dispose();
      const model = monaco.editor.createModel(text[pane], undefined, uri);
      this._models.push(model);

      const editor = monaco.editor.create(host, {
        model,
        readOnly: pane !== "result",
        domReadOnly: pane !== "result",
        automaticLayout: true,
        fontLigatures: true,
        fontFamily: this._options.fontFamily,
        ...editorFont({ phone: this._options.phone ?? false }),
        minimap: { enabled: false },
        folding: false,
        glyphMargin: false,
        lineNumbersMinChars: 3,
        lineDecorationsWidth: 10,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        renderLineHighlight: pane === "result" ? "line" : "none",
        scrollBeyondLastLine: false,
        contextmenu: pane === "result",
        fixedOverflowWidgets: true,
      });
      this._editors[pane] = editor;

      const overlay = insulate(document.createElement("div"));
      overlay.dataset.mergeOverlay = pane;
      overlay.style.cssText =
        "position:absolute;top:0;left:0;pointer-events:none;";
      editor.addOverlayWidget({
        getId: () => `pg-merge.overlay.${pane}`,
        getDomNode: () => overlay,
        getPosition: () => null,
      });
      this._overlays[pane] = overlay;
      const size = () => {
        const info = editor.getLayoutInfo();
        overlay.style.width = `${info.width - info.verticalScrollbarWidth}px`;
        overlay.style.height = `${info.height}px`;
      };
      size();

      this._disposables.push(
        editor.onDidLayoutChange(() => {
          size();
          this._emit();
        }),
        editor.onDidScrollChange((e) => {
          if (e.scrollTopChanged && !this._syncing) {
            this._syncing = true;
            for (const other of Object.values(this._editors)) {
              if (other !== editor) other.setScrollTop(e.scrollTop);
            }
            this._syncing = false;
          }
          this._emit();
        })
      );
    }

    const result = new MergeResult(
      file,
      this._editors.result!.getModel()!,
      (change) => {
        this._refresh();
        for (const cb of this._editListeners) cb(change);
      }
    );
    this._disposables.push(result);
    return result;
  }

  get layout() {
    return this._layout;
  }

  onDidChangeLayout(cb: () => void): Disposable {
    this._layoutListeners.add(cb);
    return { dispose: () => this._layoutListeners.delete(cb) };
  }

  onDidEditResult(cb: (change: ResultChange) => void): Disposable {
    this._editListeners.add(cb);
    return { dispose: () => this._editListeners.delete(cb) };
  }

  decide(index: number, side: HunkSide, action: HunkAction) {
    const changed = this._result.decide(index, side, action);
    if (changed) this._refresh();
    return changed;
  }

  update(options: Partial<MergeEditorOptions>) {
    this._options = { ...this._options, ...options };
    if (options.fontFamily !== undefined) {
      for (const editor of Object.values(this._editors)) {
        editor.updateOptions({ fontFamily: options.fontFamily });
      }
    }
    if (options.phone !== undefined) {
      for (const editor of Object.values(this._editors)) {
        editor.updateOptions(editorFont({ phone: options.phone }));
      }
    }
    this._refresh();
  }

  unfold(key: string) {
    this._opened.add(key);
    this._refresh();
  }

  reveal(hunk: number) {
    const found = this._file.hunks[hunk];
    const editor = this._editors.result;
    if (!found || !editor) return;
    const start = this._file.starts("result").starts[found.segment];
    editor.revealLineInCenter(start + 1);
  }

  dispose() {
    if (this._frame !== null) cancelAnimationFrame(this._frame);
    for (const d of this._disposables) d.dispose();
    for (const editor of Object.values(this._editors)) editor.dispose();
    for (const model of this._models) model.dispose();
    this._layoutListeners.clear();
    this._editListeners.clear();
  }

  /** The folds in force: none when showing everything or unable to hide */
  private _activeFolds(): Fold[] {
    if (this._options.showAll || !this._canFold()) return [];
    return this._file.folds().filter((f) => !this._opened.has(f.key));
  }

  private _canFold() {
    const editor = this._editors.result;
    return !!editor && canHideLines(editor);
  }

  /** Decorations, spacers, folds: everything that follows the file's state */
  private _refresh() {
    const file = this._file;
    const folds = this._activeFolds();
    const changes = file.changes();

    for (const pane of PANES) {
      const editor = this._editors[pane];
      if (!editor) continue;
      const { starts } = file.starts(pane);
      const decorations: monaco.editor.IModelDeltaDecoration[] = [];
      for (const { hunk, segment } of file.hunks) {
        const count = hunk.lines[pane];
        if (!count) continue;
        const start = starts[segment];
        decorations.push({
          range: new monaco.Range(start + 1, 1, start + count, 1),
          options: {
            isWholeLine: true,
            className: hunkLineClass(file.look(hunk, pane)),
          },
        });
      }
      for (const change of changes) {
        if (!change.count || !change.panes.includes(pane)) continue;
        const start = starts[change.segment] + change.offset;
        decorations.push({
          range: new monaco.Range(start + 1, 1, start + change.count, 1),
          options: { isWholeLine: true, className: hunkLineClass("changed") },
        });
      }
      this._decorations[pane] = editor.deltaDecorations(
        this._decorations[pane] ?? [],
        decorations
      );
    }

    // Zones and hidden lines are rebuilt only when they would change:
    // rebuilding them re-lays out the editor, and a keystroke in a settled
    // line changes neither
    const spacers = this._options.single ? [] : this._spacers();
    const bars = this._bars();
    const key = JSON.stringify([
      spacers.map(({ pane, after, lines, look }) => [pane, after, lines, look]),
      folds.map((f) => [f.key, f.start, f.count]),
      bars,
    ]);
    if (key !== this._zoneKey) {
      this._zoneKey = key;
      this._rebuildZones(spacers, folds, bars);
    }
    this._emit();
  }

  /**
   * The blank lines that keep a run the same height in all three panes: the
   * tallest pane's count, less this pane's, after the run's last line.
   */
  private _spacers() {
    const file = this._file;
    const starts = Object.fromEntries(
      PANES.map((pane) => [pane, file.starts(pane).starts])
    ) as Record<MergePane, number[]>;
    const spacers: Array<{
      pane: MergePane;
      after: number;
      lines: number;
      look: string | null;
    }> = [];
    file.segments.forEach((segment, i) => {
      const tallest = Math.max(...PANES.map((p) => segment.lines[p]));
      for (const pane of PANES) {
        const lines = tallest - segment.lines[pane];
        if (!lines || !this._editors[pane]) continue;
        spacers.push({
          pane,
          after: starts[pane][i] + segment.lines[pane],
          lines,
          look:
            segment.kind === "hunk"
              ? mergeHunkVariants({ state: file.look(segment, pane) })
              : null,
        });
      }
    });
    return spacers;
  }

  /**
   * One pane at a time, the room under each hunk still to decide for its
   * bar, as the line in the result it goes after: the result carries both
   * sides' controls, and over the lines they would cover what they decide.
   */
  private _bars() {
    if (!this._options.single) return [];
    const { starts } = this._file.starts("result");
    return this._file.hunks
      .filter(({ hunk }) => !MergeFile.isResolved(hunk))
      .map(({ hunk, segment, index }) => ({
        index,
        after: starts[segment] + hunk.lines.result,
      }));
  }

  private _rebuildZones(
    spacers: ReturnType<MonacoMergeEditor["_spacers"]>,
    folds: Fold[],
    bars: ReturnType<MonacoMergeEditor["_bars"]>
  ) {
    for (const pane of PANES) {
      const editor = this._editors[pane];
      if (!editor) continue;
      editor.changeViewZones((zones) => {
        for (const id of this._zones[pane] ?? []) zones.removeZone(id);
        const ids: string[] = [];
        for (const spacer of spacers.filter((s) => s.pane === pane)) {
          const node = document.createElement("div");
          node.dataset.mergeSpacer = "";
          if (spacer.look) node.className = spacer.look;
          ids.push(
            zones.addZone({
              afterLineNumber: spacer.after,
              heightInLines: spacer.lines,
              domNode: node,
            })
          );
        }
        // A fold's room: its control is drawn over it, in the overlay, since
        // Monaco hides its view zones from assistive technology. After the
        // last line it hides, so the line after it -- shown -- keeps it
        // visible; at the top, before the first line.
        for (const fold of folds) {
          const node = document.createElement("div");
          node.dataset.mergeFold = "";
          const first = fold.start[pane];
          ids.push(
            zones.addZone({
              afterLineNumber: first === 0 ? 0 : first + fold.count,
              heightInPx: FOLD_PX,
              domNode: node,
            })
          );
        }
        // A bar's room, drawn over like a fold's
        for (const bar of pane === "result" ? bars : []) {
          const node = document.createElement("div");
          node.dataset.mergeBar = "";
          ids.push(
            zones.addZone({
              afterLineNumber: bar.after,
              heightInPx: BAR_PX,
              domNode: node,
            })
          );
        }
        this._zones[pane] = ids;
      });
      setHiddenLines(
        editor,
        folds.map(
          (f) =>
            new monaco.Range(f.start[pane] + 1, 1, f.start[pane] + f.count, 1)
        )
      );
    }
    this._folds = folds;
  }

  /** Re-measure on the next frame, once, however many events asked */
  private _emit() {
    if (this._frame !== null) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      this._layout = this._measure();
      for (const cb of this._layoutListeners) cb();
    });
  }

  /** Where each hunk is on screen now, and the ribbons between the panes */
  private _measure(): MergeLayout {
    const file = this._file;
    const starts = Object.fromEntries(
      PANES.map((pane) => [pane, file.starts(pane)])
    ) as Record<MergePane, { starts: number[]; total: number }>;

    /** The top of 1-based `line` in a pane, scrolled; past the end, the bottom */
    const topOf = (pane: MergePane, line: number) => {
      const editor = this._editors[pane]!;
      const model = editor.getModel()!;
      const scroll = editor.getScrollTop();
      if (line <= model.getLineCount()) {
        return editor.getTopForLineNumber(line) - scroll;
      }
      const last = model.getLineCount();
      return (
        editor.getTopForLineNumber(last) +
        editor.getOption(monaco.editor.EditorOption.lineHeight) -
        scroll
      );
    };

    const lineHeight =
      this._editors.result?.getOption(monaco.editor.EditorOption.lineHeight) ??
      19;

    /**
     * A bar's top: the top of the room its zone keeps after 1-based line
     * `after`, which is the bottom of that line -- or the top of the text,
     * after line 0. Read from the line the zone follows, not the one after
     * it: a hunk that ends the file has no line after it, and the end of
     * the text is below the room, not above it.
     */
    const barTop = (after: number) => {
      const editor = this._editors.result!;
      const scroll = editor.getScrollTop();
      if (after === 0) return -scroll;
      return editor.getTopForLineNumber(after) + lineHeight - scroll;
    };
    const hunks: HunkPlace[] = [];
    const bands: MergeLayout["bands"] = { left: [], right: [] };

    for (const { hunk, segment, index } of file.hunks) {
      // Side by side, a run starts at the same height in every pane, so it is
      // read from a pane where it has lines; alone, the result is all there is
      const from = this._options.single
        ? "result"
        : PANES.find((p) => this._editors[p] && hunk.lines[p] > 0) ?? "result";
      const y = topOf(from, starts[from].starts[segment] + 1);
      const top = Object.fromEntries(
        PANES.map((p) => [p, this._editors[p] ? y : null])
      ) as Record<MergePane, number | null>;
      const bar = this._options.single
        ? barTop(starts.result.starts[segment] + hunk.lines.result)
        : null;
      hunks.push({ index, top, bar });

      const span = (pane: MergePane) => y + hunk.lines[pane] * lineHeight;
      bands.left.push({
        fromTop: y,
        fromBottom: span("left"),
        toTop: y,
        toBottom: span("result"),
        state: file.look(hunk, "left"),
      });
      bands.right.push({
        fromTop: y,
        fromBottom: span("result"),
        toTop: y,
        toBottom: span("right"),
        state: file.look(hunk, "right"),
      });
    }

    // A side's own change, joined to the result while the result marks it.
    // A settled run starts at the same height in every pane, so it is read
    // from the result; a deletion is a band of no height, a line.
    for (const change of file.changes()) {
      if (!change.panes.includes("result")) continue;
      const y = topOf(
        "result",
        starts.result.starts[change.segment] + change.offset + 1
      );
      const bottom = y + change.count * lineHeight;
      const band: MergeBand = {
        fromTop: y,
        fromBottom: bottom,
        toTop: y,
        toBottom: bottom,
        state: "changed",
      };
      if (change.panes.includes("left")) bands.left.push(band);
      if (change.panes.includes("right")) bands.right.push(band);
    }

    // A fold's room sits right above the first line shown after it
    const folds = this._folds.map((fold) => ({
      key: fold.key,
      count: fold.count,
      top: Object.fromEntries(
        PANES.map((p) => [
          p,
          this._editors[p]
            ? topOf(p, fold.start[p] + fold.count + 1) - FOLD_PX
            : null,
        ])
      ) as Record<MergePane, number | null>,
    }));

    return {
      overlays: { ...this._overlays },
      hunks,
      bands,
      folds,
      canFold: this._canFold(),
    };
  }
}
