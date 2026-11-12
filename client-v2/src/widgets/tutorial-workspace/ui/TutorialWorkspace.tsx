/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import type { FC, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { EditorTabsShown } from "@/components/EditorWithTabs";
import type { Doc } from "@/entities/tutorial";
import { onCodeRequest, onDocRequest } from "@/entities/tutorial";
import { PgCallPanel } from "@/features/tutorial-conversation";
import { useRenderOnChange } from "@/hooks";
import { createLogger } from "@/shared/lib/logger";
import { PgCommon, PgExplorer, PgTutorial } from "@/utils";
import { PgEditor } from "@/utils/editor";
import { PgFlow } from "@/views/flow/state/stage";
import { PgBuildOutput } from "@/views/sidebar/assistant/bridge/build-output";

import type { LineMarks } from "../model/lines";
import { NO_MARKS } from "../model/lines";
import {
  readFrontDoc,
  readOpenDocs,
  writeFrontDoc,
  writeOpenDocs,
} from "../model/open-docs";
import type { DocOpenVia, TreeSource } from "../model/telemetry";
import { tutorialWorkspaceTelemetry } from "../model/telemetry";
import { autoOpenReason, resetsDeploys } from "../model/terminal";
import { createdIn, tabsOf, treeRows, tutorialFiles } from "../model/tree";
import BaseDockedTree from "./BaseDockedTree";
import BaseDocPage from "./BaseDocPage";
import BaseFilesSheet from "./BaseFilesSheet";
import BasePhoneCodeHead from "./BasePhoneCodeHead";
import BaseWorkspaceHead from "./BaseWorkspaceHead";
import { CallButton, CallPanel, CallSheet } from "./CallPanel";
import { useEditorLines } from "./use-editor-lines";
import { useLogRequests } from "./use-log-requests";
import { pickedDiagnostic } from "./use-terminal-facts";

const log = createLogger("tutorial-workspace:workspace");

/** A doc page the tutorial lists, with the Markdown it carries */
type DocPage = Doc & { markdown: string };

/** The workspace is wide enough to dock the tree beside the editor from here */
export const DOCK_MIN_PX = 1100;

/** The tutorials whose tree is docked, by name: one small list per device */
const DOCKED_KEY = "tutorial-workspace.docked";

const readDocked = (): string[] => {
  try {
    const raw = localStorage.getItem(DOCKED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((n): n is string => typeof n === "string")
      : [];
  } catch (error) {
    // A broken or blocked store reads as nothing docked; the tree still opens
    log.warn("could not read the docked trees", { context: { error } });
    return [];
  }
};

const writeDocked = (name: string, docked: boolean) => {
  const names = readDocked().filter((n) => n !== name);
  try {
    localStorage.setItem(
      DOCKED_KEY,
      JSON.stringify(docked ? [...names, name] : names)
    );
  } catch (error) {
    // The dock still holds for the visit; only the next one forgets it
    log.warn("could not save the docked tree", { context: { error } });
  }
};

/** A full explorer path as the tutorial names it, from the project root */
const relOf = (full: string | null) => {
  if (!full) return null;
  const root = PgCommon.appendSlash(PgExplorer.getProjectRootPath());
  return full.startsWith(root) ? full.slice(root.length) : full;
};

/** The shell's console as the stage sees it (`LayoutShellProps.stage`) */
export interface WorkspaceConsole {
  open: boolean;
  setOpen: (open: boolean, via: "button" | "auto") => void;
}

/**
 * Where the workspace is drawn: the desktop's frame, the phone's Code space,
 * or neither
 */
export type WorkspaceLayout = "frame" | "phone";

export interface TutorialWorkspaceProps {
  /**
   * The layout the tutorial shows in. With none, the wrapper still renders,
   * with no head and no tree, so the stage under it never remounts on the
   * way in or out, nor between the frame and the phone
   */
  layout?: WorkspaceLayout;
  /** The shell's console, which the head's Terminal and the auto-open drive */
  console: WorkspaceConsole;
  /** The Files and Terminal keys as the tips show them ("⌘E", "⌘J") */
  keys: { files: string; terminal: string };
  /**
   * The written, arriving and landing lines of a file, from the feed (task
   * 3.3) and the question card; none until they pass it
   */
  marks?: (file: string) => Partial<LineMarks>;
  /** The stage: the editor, under the head and beside the docked tree */
  children: ReactNode;
}

/**
 * A tutorial's workspace (`tutorial-flow-v2` 2.2): the head over the stage,
 * the tree docked beside it, the editor's line states, and the terminal's
 * auto-open. Mounted by the view in the frame's stage while a tutorial with
 * a definition is open; the upstream tab row is not drawn under it. On the
 * phone (5.1) the head is the Code head, the tree and the Call panel are
 * sheets, and the rest runs as in the frame.
 */
const TutorialWorkspace: FC<TutorialWorkspaceProps> = ({
  layout,
  console: terminal,
  keys,
  marks,
  children,
}) => {
  useRenderOnChange(PgTutorial.onDidChange);
  useRenderOnChange(PgExplorer.onDidOpenFile);
  useRenderOnChange(PgExplorer.onDidCreateItem);
  useRenderOnChange(PgExplorer.onDidDeleteItem);
  const tutorial = PgTutorial.current;
  const definition = layout ? tutorial?.definition : undefined;
  const active = definition !== undefined;
  const frame = active && layout === "frame";
  const phone = active && layout === "phone";
  const name = tutorial?.name ?? "";

  const files = useMemo(
    () => (definition ? tutorialFiles(definition) : []),
    [definition]
  );
  // Deleting the last project re-renders the frame before the route leaves
  // the lesson, and with no project open the explorer has no path to give
  const hasProject =
    PgExplorer.isTemporary || PgExplorer.currentWorkspaceName !== undefined;
  const present = new Set(
    hasProject
      ? files.filter((f) => PgExplorer.files[PgExplorer.convertToFullPath(f)])
      : []
  );
  // The pages the tutorial lists and carries; one whose Markdown is not in
  // the bundle never shows (the loader rejects such a tutorial anyway).
  const pages = tutorial?.docPages;
  const docs = useMemo<DocPage[]>(
    () =>
      (definition?.docs ?? []).flatMap((doc) => {
        const markdown = pages?.[doc.file];
        return markdown === undefined ? [] : [{ ...doc, markdown }];
      }),
    [definition, pages]
  );
  const [openDocs, setOpenDocs] = useState<string[]>([]);
  const [doc, setDoc] = useState<string>();
  useEffect(() => {
    setOpenDocs(readOpenDocs()[name] ?? []);
    // The page that was in front comes back in front, as a reload restores
    // the rest of the workspace
    setDoc(readFrontDoc(name));
  }, [name]);
  const docTabs = docs.filter((d) => openDocs.includes(d.file));
  const frontDoc = docTabs.find((d) => d.file === doc);
  const front = frontDoc?.file;

  const open = relOf(PgExplorer.currentFilePath);
  const page = PgTutorial.pageNumber;
  const live =
    definition && page ? definition.steps[page - 1]?.file ?? null : null;
  const rows = treeRows({
    files,
    present,
    open,
    live,
    createdIn: (path) => (definition ? createdIn(definition, path) : null),
    docs,
    openDoc: front,
  });

  const box = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setWide(entry.contentRect.width >= DOCK_MIN_PX)
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [treeOpen, setTreeOpen] = useState(false);
  const [docked, setDocked] = useState(() => readDocked().includes(name));
  useEffect(() => setDocked(readDocked().includes(name)), [name]);
  const dockedShown = docked && wide;

  const dock = (next: boolean) => {
    setDocked(next);
    setTreeOpen(false);
    writeDocked(name, next);
    tutorialWorkspaceTelemetry.track("tutorial_workspace_tree_docked", {
      docked: next,
    });
  };
  const toggleTree = (via: TreeSource) => {
    if (dockedShown) return dock(false);
    if (!treeOpen) {
      tutorialWorkspaceTelemetry.track("tutorial_workspace_tree_opened", {
        via,
      });
    }
    setTreeOpen(!treeOpen);
  };
  const openFile = (path: string, via: "tab" | "tree") => {
    setTreeOpen(false);
    // A press on a tab leaves the panel, also on the file under it
    PgCallPanel.close();
    // The file comes back in front of the page, which keeps its tab; at once,
    // so the editor is no longer inert when `pickFocus` asks for it
    if (front === undefined) setDoc(undefined);
    else {
      flushSync(() => setDoc(undefined));
      writeFrontDoc(name, undefined);
    }
    // From the tree's popover, which keeps focus from an open (see
    // `leavesFocusElsewhere`): the pick itself asks for the editor, also when
    // its file is the one already open. The docked tree is no popover, and a
    // pick there of the open file stays in it
    const pickFocus = () => {
      if (via === "tree" && treeOpen) PgEditor.focus();
    };
    if (path === open) {
      pickFocus();
      return;
    }
    PgExplorer.openFile(PgExplorer.convertToFullPath(path));
    pickFocus();
    tutorialWorkspaceTelemetry.track("tutorial_workspace_file_opened", { via });
  };

  /** Brings a doc page to the front; false for a page this tutorial lacks */
  const showDoc = (file: string, via: DocOpenVia): boolean => {
    if (!docs.some((d) => d.file === file)) {
      // The link matched the definition's list, but the bundle has no page
      log.warn("asked for a doc page this tutorial does not carry", {
        context: { file, tutorial: name },
      });
      return false;
    }
    setTreeOpen(false);
    const next = openDocs.includes(file) ? openDocs : [...openDocs, file];
    if (next !== openDocs) {
      setOpenDocs(next);
      writeOpenDocs(name, next);
    }
    // A page opened leaves the panel, as a file does
    PgCallPanel.close();
    if (file === front) return true;
    setDoc(file);
    writeFrontDoc(name, file);
    if (via !== "tab") {
      tutorialWorkspaceTelemetry.track("tutorial_workspace_doc_opened", {
        doc: file,
        via,
      });
    }
    return true;
  };
  const closeDoc = (file: string) => {
    const next = openDocs.filter((f) => f !== file);
    setOpenDocs(next);
    writeOpenDocs(name, next);
    if (file !== front) return;
    setDoc(undefined);
    writeFrontDoc(name, undefined);
  };

  // The assistant's doc links reach the workspace here; a page never opens
  // by itself
  const showDocNow = useRef(showDoc);
  showDocNow.current = showDoc;
  useEffect(() => {
    if (!active) return;
    return onDocRequest((file) => showDocNow.current(file, "assistant"));
  }, [active]);

  // The code comes back in front of a page whenever the lesson shows it: a
  // file it opens (a step's file, a quote's) or a line in the open one
  useEffect(() => {
    if (!active) return;
    const toCode = () => {
      setDoc(undefined);
      writeFrontDoc(name, undefined);
    };
    // `onDidOpenFile` replays the open file as it subscribes, in the call
    // itself: that shows nothing new, and would hide the page a reload restores.
    // With no file open yet (a slow boot) there is no replay, and the first
    // report is the workspace opening its current file, which is the same
    // restore arriving late: it must not take the page either
    let isReplay = true;
    let isRestored = false;
    const opened = PgExplorer.onDidOpenFile(() => {
      if (isReplay) {
        isRestored = true;
        return;
      }
      if (!isRestored) {
        isRestored = true;
        return;
      }
      toCode();
    });
    isReplay = false;
    const stop = onCodeRequest(toCode);
    return () => {
      opened.dispose();
      stop();
    };
  }, [active, name]);

  // ⌘E (Ctrl E off a Mac), even from the editor, the composer or the tree's
  // own popover: Monaco's own ⌘E (find with the selection) loses to it here,
  // as the spec lists it among the keys that fire from a text field. Not from
  // another dialog, nor while a page covers the work (the frame is inert
  // under it), nor from the terminal off a Mac, where Ctrl E is the shell's
  // end of line; a Control on a Mac stays the field's
  const toggleNow = useRef(toggleTree);
  toggleNow.current = toggleTree;
  useEffect(() => {
    if (!frame) return;
    const mac = PgCommon.getOS() === "MacOS";
    const onKey = (e: KeyboardEvent) => {
      const primary = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!primary || e.altKey || e.shiftKey || e.key.toLowerCase() !== "e") {
        return;
      }
      if (e.repeat || e.isComposing) return;
      const target = e.target instanceof Element ? e.target : null;
      const dialog = target?.closest("[role='dialog'], [role='alertdialog']");
      if (dialog && !dialog.querySelector("[role='tree']")) return;
      if (!mac && target?.closest(".xterm")) return;
      if (box.current?.closest("[inert]")) return;
      e.preventDefault();
      e.stopPropagation();
      toggleNow.current("key");
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [frame]);

  // The drawer opens by itself on a failed build and the first deploy.
  // TODO(tutorial-flow-v2 3.3): a component test over a stubbed PgFlow for
  // this wiring and for the stage not remounting when `active` flips; the
  // rules are tested in `model/terminal.ts`, and the feed's own tests will
  // drive this component with a real engine
  const terminalNow = useRef(terminal);
  terminalNow.current = terminal;
  useEffect(() => {
    if (!active) return;
    let prev = PgFlow.state;
    let deployedBefore = prev.deploy === "done";
    const sub = PgFlow.onDidChange((next) => {
      const reason = autoOpenReason({ prev, next, deployedBefore });
      // Another workspace's record starts over: its first deploy is due
      if (resetsDeploys(next)) deployedBefore = false;
      if (next.deploy === "done") deployedBefore = true;
      prev = next;
      // Behind a page the work is not on screen: nothing to open there
      if (!reason || terminalNow.current.open) return;
      if (box.current?.closest("[inert]")) return;
      terminalNow.current.setOpen(true, "auto");
      tutorialWorkspaceTelemetry.track("tutorial_workspace_terminal_opened", {
        reason,
      });
    });
    return () => sub.dispose();
  }, [active, name]);

  useLogRequests(active, terminalNow, box);

  // A file opened from anywhere (the feed's "Show in lib.rs") is to be seen
  useEffect(() => {
    if (!active) return;
    const sub = PgExplorer.onDidOpenFile(() => PgCallPanel.close());
    return () => sub.dispose();
  }, [active]);
  useRenderOnChange(PgCallPanel.onDidChange);

  // The line states of the open file. A failed build's output lands a
  // moment after its event, and the squiggle reads it
  useRenderOnChange(PgFlow.onDidChange);
  useRenderOnChange(PgBuildOutput.onDidChange);
  const flow = PgFlow.state;
  const busy = flow.build === "running" || flow.deploy === "running";
  const diagnostic = flow.build === "failed" ? pickedDiagnostic() : null;
  const given = open && marks ? marks(open) : {};
  const lineMarks: LineMarks = {
    written: given.written ?? NO_MARKS.written,
    arriving: given.arriving ?? NO_MARKS.arriving,
    landing: given.landing ?? NO_MARKS.landing,
    error:
      diagnostic && diagnostic.file === open && diagnostic.line !== null
        ? { line: diagnostic.line, column: diagnostic.col, span: null }
        : given.error ?? NO_MARKS.error,
  };
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  useEditorLines({ root: active ? stage : null, marks: lineMarks, busy });

  const [filesOpen, setFilesOpen] = useState(false);

  return (
    <div
      ref={box}
      data-testid={active ? "tutorial-workspace" : undefined}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {phone && (
        <BasePhoneCodeHead
          file={open}
          doc={frontDoc?.title}
          onFiles={() => setFilesOpen(true)}
          call={<CallButton />}
        />
      )}
      {frame && (
        <BaseWorkspaceHead
          tabs={tabsOf(files, present)}
          active={PgCallPanel.isOpen ? null : open}
          onOpen={(path) => openFile(path, "tab")}
          docs={{
            tabs: docTabs,
            active: PgCallPanel.isOpen ? undefined : front,
            onOpen: (file) => showDoc(file, "tab"),
            onClose: closeDoc,
          }}
          tree={{
            open: treeOpen,
            docked: dockedShown,
            canDock: wide,
            rows,
            onToggle: toggleTree,
            onClose: () => setTreeOpen(false),
            onPick: (path) => openFile(path, "tree"),
            onPickDoc: (file) => showDoc(file, "tree"),
            onDock: () => dock(true),
          }}
          call={<CallButton />}
          terminal={{
            open: terminal.open,
            onToggle: () => terminal.setOpen(!terminal.open, "button"),
          }}
          filesKey={keys.files}
          terminalKey={keys.terminal}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {frame && wide && (
          <BaseDockedTree
            open={dockedShown}
            rows={rows}
            onPick={(path) => openFile(path, "tree")}
            onPickDoc={(file) => showDoc(file, "tree")}
            onUndock={() => dock(false)}
          />
        )}
        {/* A doc page covers the editor, which stays mounted under it and
            inert (no focus, no pointer, hidden from assistive tech) while a
            page is in front */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={setStage}
            inert={(active && front !== undefined) || undefined}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <EditorTabsShown.Provider value={!active}>
              {children}
            </EditorTabsShown.Provider>
          </div>
          {active && frontDoc && (
            <div className="absolute inset-0 z-10 flex">
              {/* One page per doc, so each opens at its top */}
              <BaseDocPage
                key={frontDoc.file}
                title={frontDoc.title}
                url={frontDoc.url}
                markdown={frontDoc.markdown}
                phone={phone}
              />
            </div>
          )}
          {/* Over the editor, which must never unmount */}
          {frame && <CallPanel />}
        </div>
      </div>
      {phone && (
        <>
          <BaseFilesSheet
            open={filesOpen}
            onOpenChange={setFilesOpen}
            rows={rows}
            onPick={(path) => openFile(path, "tree")}
            onPickDoc={(file) => showDoc(file, "tree")}
          />
          <CallSheet />
        </>
      )}
    </div>
  );
};

export default TutorialWorkspace;
