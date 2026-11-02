import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { usePgTheme } from "@/shared/lib/hooks/use-pg-theme";
import { Button } from "@/shared/ui/button";
import { useViewport } from "@/shared/lib/hooks/use-viewport";
import {
  Merge,
  MergeCount,
  MergeFold,
  MergeFooter,
  MergeFooterActions,
  MergeFooterShortcuts,
  MergeHunkAction,
  MergeHunkActions,
  MergeHunkBar,
  MergeHunkBarSide,
  MergeHunkGutter,
  mergeHunkOrder,
  MergeNav,
  MergePane,
  MergePaneBody,
  MergePaneHeader,
  MergePanes,
  MergePaneTabs,
  MergeRibbon,
  MergeShowAll,
  MergeTitle,
  MergeToolbar,
} from "@/shared/ui/merge";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
} from "@/shared/ui/modal";
import { createMergeEditor } from "./merge-editor/controller";
import { MergeFile, resolvedFiles } from "./merge-editor/merge-file";
import type { MergeEditor, MergeLayout } from "./merge-editor/controller";
import type { HunkAction } from "./merge-editor/result-model";
import type { HunkSide, MergePane as Pane } from "./merge-editor/merge-file";
import type { FileConflict, ResolvedFiles } from "../model/merge";

export interface BaseConflictResolverProps {
  /** The conflicted files, as the divergent conflict holds them */
  files: FileConflict[];
  /** Files that changed on the other device since the view first showed them */
  changed?: string[];
  /** An answer is on its way: nothing more can be pressed */
  busy?: boolean;
  /** The result of every file, pinned to the copies it was made against */
  onApply: (files: ResolvedFiles) => void;
  /** "Keep this version", as the banner's */
  onKeepLocal: () => void;
  /** "Take the other version", as the banner's */
  onTakeServer: () => void;
  /**
   * Closed without an answer: Cancel, the close button or Escape -- once
   * confirmed, where a choice had been made. A click outside never closes.
   */
  onCancel: () => void;
  /**
   * A hunk went from undecided to resolved: by taking or dismissing `side`,
   * or by typing over it (`edit`, no side). Not called for undo and redo.
   */
  onHunkResolved?: (how: HunkAction | "edit", side: HunkSide | null) => void;
}

/** Below this the element shows one pane at a time (`@3xl/merge`) */
const SINGLE_BELOW_PX = 768;

/**
 * Whether the view is narrow enough to show one pane at a time. The element
 * decides that with a container query; the editors need to know as well, to
 * drop their spacers and put every hunk control in Result.
 */
const useSingle = (root: HTMLElement | null) => {
  const [single, setSingle] = useState(false);
  useEffect(() => {
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setSingle(entry.contentRect.width < SINGLE_BELOW_PX)
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [root]);
  return single;
};

/** Monaco's widgets that Escape closes, as they are marked while shown */
const EDITOR_WIDGETS = [
  ".suggest-widget.visible",
  ".find-widget.visible",
  ".parameter-hints-widget.visible",
].join(",");

/**
 * Whether an Escape belongs to the editor it was pressed in: one of its
 * suggest, find or parameter-hint widgets is open, and Escape closes that.
 * Radix listens for Escape on the whole document, ahead of the editor, and
 * would close the view instead. With no widget open, Escape is the view's,
 * so a keyboard user can leave from the result.
 */
const isEditorEscape = (event: KeyboardEvent) => {
  const editor =
    event.target instanceof Element && event.target.closest(".monaco-editor");
  return !!editor && !!editor.querySelector(EDITOR_WIDGETS);
};

/** The indices of a file's resolved hunks */
const resolvedHunks = (file: MergeFile) =>
  new Set(
    file.hunks
      .filter(({ hunk }) => MergeFile.isResolved(hunk))
      .map(({ index }) => index)
  );

/** The sides whose controls a pane carries */
const sidesIn = (pane: Pane, single: boolean): HunkSide[] => {
  if (single) return pane === "result" ? ["left", "right"] : [];
  if (pane === "left") return ["left"];
  if (pane === "right") return ["right"];
  return [];
};

/**
 * Two devices' changes to the same lines, settled line by line: this device
 * on the left, the result in the middle, the other device on the right.
 *
 * Takes everything through props; the editors are the Monaco controller's
 * (`merge-editor/`), one file's at a time. Nothing is written anywhere until
 * `onApply` or a whole-file shortcut is called, and Apply stays disabled
 * while any hunk of any file is undecided.
 */
export const BaseConflictResolver = ({
  files,
  changed = [],
  busy = false,
  onApply,
  onKeepLocal,
  onTakeServer,
  onCancel,
  onHunkResolved,
}: BaseConflictResolverProps) => {
  // A new set of files is a new question: every choice starts over
  const merges = useMemo(() => files.map((f) => MergeFile.from(f)), [files]);
  const [path, setPath] = useState(files[0]?.path);
  const index = Math.max(
    0,
    merges.findIndex((m) => m.path === path)
  );
  const file = merges[index];
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const [root, setRoot] = useState<HTMLElement | null>(null);
  const single = useSingle(root);
  const [showAll, setShowAll] = useState(false);
  const theme = usePgTheme() as
    | { components?: { editor?: { default?: { fontFamily?: string } } } }
    | undefined;
  const fontFamily = theme?.components?.editor?.default?.fontFamily;
  const phone = useViewport() === "phone";

  const hosts = {
    left: useRef<HTMLDivElement>(null),
    result: useRef<HTMLDivElement>(null),
    right: useRef<HTMLDivElement>(null),
  };
  const [editor, setEditor] = useState<MergeEditor | null>(null);
  // Read by the editor's listener, which is set up once per file
  const resolvedHook = useRef(onHunkResolved);
  resolvedHook.current = onHunkResolved;
  // Which of the file's hunks were resolved before the last change, to tell
  // the ones typing has just answered
  const resolved = useRef(new Set<number>());
  // The hunk last revealed or decided in this file, where Next and Previous
  // count from
  const current = useRef<number | null>(null);
  const [layout, setLayout] = useState<MergeLayout | null>(null);
  // Closing was asked for with work done: the footer asks to confirm
  const [confirming, setConfirming] = useState(false);

  // The Modal mounts its content in a portal after this renders, so the
  // editors are created once the hosts are there
  const [mounted, setMounted] = useState(false);
  const contentRef = useCallback(
    (node: HTMLDivElement | null) => setMounted(!!node),
    []
  );
  useEffect(() => {
    if (!mounted || !file || !hosts.result.current) return;
    const created = createMergeEditor(
      file,
      {
        left: file.deleted.left ? null : hosts.left.current,
        result: hosts.result.current,
        right: file.deleted.right ? null : hosts.right.current,
      },
      { single, showAll, fontFamily, phone }
    );
    setEditor(created);
    setLayout(created.layout);
    resolved.current = resolvedHunks(file);
    current.current = null;
    const subscriptions = [
      created.onDidChangeLayout(() => setLayout(created.layout)),
      created.onDidEditResult((change) => {
        const now = resolvedHunks(file);
        if (change === "typed") {
          for (const i of now) {
            if (!resolved.current.has(i)) resolvedHook.current?.("edit", null);
          }
        }
        resolved.current = now;
        rerender();
      }),
    ];
    return () => {
      for (const s of subscriptions) s.dispose();
      created.dispose();
      setEditor(null);
      setLayout(null);
    };
    // The options below are passed to the live editor by the next effect;
    // only a new file, or the hosts arriving, makes new editors
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, file]);

  useEffect(() => {
    editor?.update({ single, showAll, fontFamily, phone });
  }, [editor, single, showAll, fontFamily, phone]);

  const unresolved = merges.reduce((n, m) => n + m.unresolved, 0);

  /**
   * Cancel, the close button or Escape: closes at once when nothing was done
   * yet, and otherwise asks first, since closing drops every choice made
   */
  const requestClose = () => {
    if (merges.some((m) => m.touched)) setConfirming(true);
    else onCancel();
  };

  /** Escape is an open editor widget's first, then backs out of the question */
  const onEscape = (event: KeyboardEvent) => {
    if (isEditorEscape(event)) {
      event.preventDefault();
    } else if (confirming) {
      event.preventDefault();
      setConfirming(false);
    }
  };

  const act = (hunk: number, side: HunkSide, action: HunkAction) => {
    const found = file?.hunks[hunk]?.hunk;
    const before = !!found && MergeFile.isResolved(found);
    if (!editor?.decide(hunk, side, action)) return;
    current.current = hunk;
    if (found && !before && MergeFile.isResolved(found)) {
      onHunkResolved?.(action, side);
    }
    if (file) resolved.current = resolvedHunks(file);
    rerender();
  };

  /**
   * Scroll to the next or previous hunk still to decide, counted from the
   * last one revealed or decided, wrapping. Before either, forward starts at
   * the first and back at the last.
   */
  const goTo = (step: 1 | -1) => {
    if (!file || !editor) return;
    const open = file.hunks
      .filter(({ hunk }) => !MergeFile.isResolved(hunk))
      .map(({ index: i }) => i);
    if (!open.length) return;
    const from = current.current;
    const target =
      step > 0
        ? open.find((i) => from === null || i > from) ?? open[0]
        : [...open].reverse().find((i) => from === null || i < from) ??
          open[open.length - 1];
    current.current = target;
    editor.reveal(target);
  };

  /** Which hunk, in words, so no two hunks' controls share a name */
  const hunkName = (i: number) =>
    `conflict ${i + 1} of ${file?.hunks.length ?? 0}`;

  /** A side's take and dismiss, mirrored about the result */
  const pair = (i: number, side: HunkSide) =>
    mergeHunkOrder[side].map((action) => (
      <MergeHunkAction
        key={action}
        action={action}
        from={side}
        hunk={hunkName(i)}
        disabled={busy}
        onClick={() => act(i, side, action)}
      />
    ));

  /**
   * A pane's hunk controls. A side's sit in its gutter beside the ribbon, at
   * each hunk's height (at the top where the side has no editor). One pane
   * at a time, the result carries both sides' in a bar in the room its
   * editor keeps under each hunk, so none covers the lines it decides.
   */
  const controls = (pane: Pane): ReactNode => {
    if (!file) return null;
    const sides = sidesIn(pane, single);
    if (!sides.length) return null;
    const overlay = pane === "result" ? layout?.overlays.result ?? null : null;
    const items = file.hunks.map(({ hunk, index: i }) => {
      const open = sides.filter((s) => !hunk.edited && hunk[s] === "pending");
      if (!open.length) return null;
      const place = layout?.hunks[i];
      if (overlay) {
        return (
          <MergeHunkBar
            key={i}
            data-hunk={i}
            hunk={hunkName(i)}
            state="conflict"
            className="absolute inset-x-0"
            style={{ top: place?.bar ?? 0, pointerEvents: "auto" }}
          >
            {open.map((side) => (
              <MergeHunkBarSide
                key={side}
                side={side}
                className={side === "right" ? "ml-auto" : undefined}
              >
                {pair(i, side)}
              </MergeHunkBarSide>
            ))}
          </MergeHunkBar>
        );
      }
      return (
        // Only a hunk with a side still open has controls, so it is a conflict
        <MergeHunkActions
          key={i}
          data-hunk={i}
          hunk={hunkName(i)}
          state="conflict"
          className="absolute inset-x-0 mx-auto w-fit"
          style={{ top: place?.top[pane] ?? 4, pointerEvents: "auto" }}
        >
          {open.map((side) => (
            <span key={side} className="contents">
              {pair(i, side)}
            </span>
          ))}
        </MergeHunkActions>
      );
    });
    return overlay ? createPortal(items, overlay) : items;
  };

  /** A pane's fold controls, over the room its editor keeps for them */
  const folds = (pane: Pane): ReactNode => {
    const overlay = layout?.overlays[pane];
    if (!overlay) return null;
    return createPortal(
      (layout?.folds ?? []).map((fold) => (
        <MergeFold
          key={fold.key}
          count={fold.count}
          className="absolute inset-x-0"
          style={{ top: fold.top[pane] ?? 0, pointerEvents: "auto" }}
          onClick={() => editor?.unfold(fold.key)}
        />
      )),
      overlay
    );
  };

  /**
   * A pane: its editor, and a side's gutter of controls where it shows --
   * after the editor on the left, before it on the right -- so the tab order
   * follows what the eye sees
   */
  const pane = (side: Pane) => {
    const gutter = side !== "result" && (
      <MergeHunkGutter>{controls(side)}</MergeHunkGutter>
    );
    return (
      <MergePane side={side} deleted={side !== "result" && file?.deleted[side]}>
        <MergePaneHeader />
        <MergePaneBody>
          {side === "right" && gutter}
          <div ref={hosts[side]} className="relative min-w-0 flex-1" />
          {folds(side)}
          {side === "result" && controls(side)}
          {side === "left" && gutter}
        </MergePaneBody>
      </MergePane>
    );
  };

  return (
    <Modal open onOpenChange={(open) => !open && requestClose()}>
      <ModalContent
        size="wide"
        className="md:h-[min(48rem,calc(100dvh-4rem))]"
        ref={contentRef}
        onEscapeKeyDown={onEscape}
        // A stray click beside the view must not close it
        onInteractOutside={(event) => event.preventDefault()}
      >
        <ModalHeader>
          <ModalTitle>Resolve conflicts</ModalTitle>
          <ModalDescription className="sr-only">
            Both devices changed the same lines. Take each side's lines into the
            result, or edit it, then apply.
          </ModalDescription>
          {changed.map((p) => (
            <p key={p} role="status" className="text-caption text-warning">
              <code className="font-mono">{p}</code> changed on the other
              device.
            </p>
          ))}
        </ModalHeader>
        <Merge ref={setRoot}>
          <MergeToolbar>
            {merges.length > 1 && (
              <>
                <MergeNav
                  to="previous-file"
                  disabled={index === 0}
                  onClick={() => setPath(merges[index - 1].path)}
                />
                <MergeNav
                  to="next-file"
                  disabled={index === merges.length - 1}
                  onClick={() => setPath(merges[index + 1].path)}
                />
              </>
            )}
            {file && (
              <MergeTitle
                path={file.path}
                index={index + 1}
                total={merges.length}
              />
            )}
            <MergeCount count={unresolved} />
            <MergeNav
              to="previous-conflict"
              disabled={!file?.unresolved}
              onClick={() => goTo(-1)}
            />
            <MergeNav
              to="next-conflict"
              disabled={!file?.unresolved}
              onClick={() => goTo(1)}
            />
            {layout?.canFold && (
              <MergeShowAll pressed={showAll} onPressedChange={setShowAll} />
            )}
          </MergeToolbar>
          <MergePaneTabs />
          <MergePanes>
            {pane("left")}
            <MergeRibbon bands={layout?.bands.left ?? []} />
            {pane("result")}
            <MergeRibbon bands={layout?.bands.right ?? []} />
            {pane("right")}
          </MergePanes>
          <MergeFooter>
            <MergeFooterShortcuts>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onKeepLocal}
              >
                Keep this version
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onTakeServer}
              >
                Take the other version
              </Button>
            </MergeFooterShortcuts>
            {confirming ? (
              <MergeFooterActions>
                <p role="alert" className="text-caption">
                  Discard your choices?
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  autoFocus
                  onClick={() => setConfirming(false)}
                >
                  Keep resolving
                </Button>
                <Button size="sm" variant="destructive" onClick={onCancel}>
                  Discard
                </Button>
              </MergeFooterActions>
            ) : (
              <MergeFooterActions>
                <Button size="sm" variant="ghost" onClick={requestClose}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={busy || unresolved > 0}
                  onClick={() => onApply(resolvedFiles(merges))}
                >
                  Apply
                </Button>
              </MergeFooterActions>
            )}
          </MergeFooter>
        </Merge>
      </ModalContent>
    </Modal>
  );
};
