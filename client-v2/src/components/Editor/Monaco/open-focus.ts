import { isTypingElsewhere } from "@/shared/lib/focus";

/** Which open the editor is answering: its mount's, or any after it */
export type OpenKind = "mount" | "later";

/**
 * Whether opening a file leaves focus in the field the user is typing in,
 * rather than the editor taking it.
 *
 * An open the user started from a field in the explorer's tree (naming a new
 * file) ends in the editor, so a later open takes focus from that field. Any
 * other field the user is typing in (the assistant's composer, a dialog's)
 * keeps focus, because nothing typed there asked for the open: sync
 * re-opening the workspace after an adoption, a merge or another tab's
 * write. The mount's open keeps focus in any field, the tree's included: the
 * new file the user is still naming has not been created yet.
 *
 * @param opts -
 * - `open`: the mount's open or a later one
 * - `editor`: the editor's container
 * - `tree`: the explorer's tree, `null` while it is not drawn
 * - `active`: the focused element, the document's by default
 */
export const leavesFocusElsewhere = ({
  open,
  editor,
  tree,
  active = document.activeElement,
}: {
  open: OpenKind;
  editor: Element;
  tree: Element | null;
  active?: Element | null;
}): boolean => {
  if (!isTypingElsewhere(editor, active)) return false;
  if (open === "mount") return true;
  return !(tree && active && tree.contains(active));
};
