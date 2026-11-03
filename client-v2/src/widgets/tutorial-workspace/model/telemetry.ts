import { createTracker } from "@/shared/lib/telemetry";

/** What opened the file tree: the active tab's chevron, the Files button, or ⌘E */
export type TreeSource = "tab" | "button" | "key";

/** Where a file was opened from: its tab in the head, or a row of the tree */
export type FileSource = "tab" | "tree";

/** Why the terminal opened by itself */
export type TerminalReason = "build_failed" | "first_deploy";

type TutorialWorkspaceEvents = {
  /**
   * The file tree opened as a popover under the active tab; `via` says
   * which control did it. Not sent when it closes.
   */
  tutorial_workspace_tree_opened: { via: TreeSource };
  /**
   * The tree's pin docked it beside the editor (`docked` true), or its
   * unpin put it back in the popover (false).
   */
  tutorial_workspace_tree_docked: { docked: boolean };
  /**
   * The learner opened a file from a tab or the tree. Not sent for the
   * file already open.
   */
  tutorial_workspace_file_opened: { via: FileSource };
  /**
   * The terminal's drawer opened on its own: a build failed, or the
   * tutorial's first deploy landed. The learner's own toggles are the
   * shell's `layout_*` events.
   */
  tutorial_workspace_terminal_opened: { reason: TerminalReason };
};

export const tutorialWorkspaceTelemetry =
  createTracker<TutorialWorkspaceEvents>();
