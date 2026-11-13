import { isTypingElsewhere } from "@/shared/lib/focus";
import { isInPager } from "@/shared/lib/pager";

/** Which open the editor is answering: its mount's, or any after it */
export type OpenKind = "mount" | "later";

/**
 * Whether opening a file leaves focus where it is, rather than the editor
 * taking it.
 *
 * An open the user started from a field in the explorer's tree (naming a new
 * file) ends in the editor, so a later open takes focus from that field. Any
 * other field the user is typing in (the assistant's composer, a dialog's)
 * keeps focus, because nothing typed there asked for the open: sync
 * re-opening the workspace after an adoption, a merge or another tab's
 * write. So does any control in an open dialog or popover (`isInDialog`),
 * which focus leaving would close, and the bare document while the tree
 * shows in one (a rename or delete of the open file from the Files
 * dropdown). The mount's open keeps focus wherever the user put it, a field
 * or a control: under load it lands late, after a click on another control
 * already moved focus (the tree's field too: the new file the user is still
 * naming has not been created yet). It takes focus from the bare document,
 * so a fresh load lands in the editor, and from an item of the tree, whose
 * click opened the file with no tab open and so mounted the editor. No open
 * takes focus while the editor is off the screen (`isOffScreen`).
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
  active: focused = document.activeElement,
}: {
  open: OpenKind;
  editor: Element;
  tree: Element | null;
  active?: Element | null;
}): boolean => {
  // A disabled control holds no focus: Chromium drops it to <body>, Firefox
  // keeps it there. A dialog's submit disables its button while it runs, so
  // both read Rename's open of the renamed file as one with nothing focused,
  // not as one "in a dialog" in Firefox alone
  // eslint-disable-next-line unicorn/no-null -- reads as `document.activeElement` with nothing focused, which is null
  const active = focused?.matches(":disabled") ? null : focused;
  // Focus scrolls the editor into view: on a phone, a swipe away from the
  // code before the file opened would be pulled back to it
  if (isOffScreen(editor)) return true;
  if (open === "mount") {
    // A click in the tree opened the file: the editor mounts to show it
    if (
      !isTypingElsewhere(editor, active) &&
      tree &&
      active &&
      tree.contains(active)
    ) {
      return false;
    }
    return isFocusedElsewhere(editor, active);
  }
  // A pick in the explorer's tree ends in the editor, the phone's Files
  // sheet (a dialog) included
  if (tree && active && tree.contains(active)) return false;
  if (isInDialog(editor, active)) return true;
  // Nothing holds focus while the tree shows in a dropdown or sheet: an open
  // nobody picked there would close it. A rename's or a delete's of the open
  // file lands with focus on the dialog's disabled submit or on <body>,
  // whichever the browser and timing give; both leave the tree open
  if (isUnfocused(active) && isTreeInDialog(tree)) return true;
  return isTypingElsewhere(editor, active);
};

/**
 * The editor sits left or right of the screen on the phone's pager, while
 * another page shows or the pager is moving to one. Only there: elsewhere it
 * is off the screen just for a moment, while a narrowed window lays out again,
 * and its focus must not be lost to that. A hidden editor has an empty box at
 * the origin, so it is not reported: focus there scrolls nothing
 */
const isOffScreen = (editor: Element) => {
  if (!isInPager(editor)) return false;
  const { left, right } = editor.getBoundingClientRect();
  // A pixel's leeway for a box at fractional coordinates
  return left < -1 || right > window.innerWidth + 1;
};

/**
 * Focus sits in an open dialog or popover, such as a tutorial's file tree:
 * an open nobody asked for from there (a step's start files re-opening its
 * file) would close it
 */
const isInDialog = (editor: Element, active: Element | null) =>
  !!active &&
  !editor.contains(active) &&
  active.closest('[role="dialog"], [role="alertdialog"]') !== null;

/** Nothing holds focus: the bare document, or a control focus left */
const isUnfocused = (active: Element | null) =>
  !active || active === document.body || active === document.documentElement;

/** The explorer's tree is drawn in a dialog or popover, such as the Files dropdown */
const isTreeInDialog = (tree: Element | null) =>
  !!tree && tree.closest('[role="dialog"], [role="alertdialog"]') !== null;

/** Focus sits on something outside the editor, not on the bare document */
const isFocusedElsewhere = (editor: Element, active: Element | null) =>
  !!active &&
  active !== document.body &&
  active !== document.documentElement &&
  !editor.contains(active);

if (import.meta.vitest) {
  const { describe, it, expect, afterEach, vi } = import.meta.vitest;

  describe("components/Editor/Monaco/open-focus", () => {
    /**
     * The page the editor sits in: the explorer's tree with a new file's name
     * field and an item, the assistant's composer, and the editor's own
     * textarea
     */
    const page = () => {
      document.body.innerHTML =
        '<div id="root-dir"><input id="name" /><div id="item" tabindex="0"></div></div>' +
        '<textarea id="composer"></textarea><button id="button"></button>' +
        '<div role="dialog"><button id="pick" role="treeitem"></button></div>' +
        '<div data-pager><div id="editor"><textarea id="inputarea"></textarea></div></div>';
      const get = (id: string) => document.getElementById(id)!;
      return {
        editor: get("editor"),
        tree: get("root-dir"),
        name: get("name"),
        item: get("item"),
        composer: get("composer"),
        button: get("button"),
        pick: get("pick"),
        inputarea: get("inputarea"),
      };
    };

    describe("leavesFocusElsewhere", () => {
      afterEach(() => {
        document.body.innerHTML = "";
        vi.restoreAllMocks();
      });

      it("leaves focus in the explorer's field on the mount's open", () => {
        const { editor, tree, name } = page();
        expect(
          leavesFocusElsewhere({ open: "mount", editor, tree, active: name })
        ).toBe(true);
      });

      it("takes focus from the explorer's field on a later open", () => {
        const { editor, tree, name } = page();
        expect(
          leavesFocusElsewhere({ open: "later", editor, tree, active: name })
        ).toBe(false);
      });

      it("leaves focus in the composer on a later open", () => {
        const { editor, tree, composer } = page();
        expect(
          leavesFocusElsewhere({
            open: "later",
            editor,
            tree,
            active: composer,
          })
        ).toBe(true);
      });

      it("leaves focus in the composer on the mount's open", () => {
        const { editor, tree, composer } = page();
        expect(
          leavesFocusElsewhere({
            open: "mount",
            editor,
            tree,
            active: composer,
          })
        ).toBe(true);
      });

      it("leaves focus on a control on the mount's open", () => {
        const { editor, tree, button } = page();
        expect(
          leavesFocusElsewhere({ open: "mount", editor, tree, active: button })
        ).toBe(true);
      });

      it("takes focus from the tree's item on the mount's open", () => {
        const { editor, tree, item } = page();
        expect(
          leavesFocusElsewhere({ open: "mount", editor, tree, active: item })
        ).toBe(false);
      });

      it("takes focus on the mount's open when nothing has it", () => {
        const { editor, tree } = page();
        expect(
          leavesFocusElsewhere({
            open: "mount",
            editor,
            tree,
            active: document.body,
          })
        ).toBe(false);
        expect(
          leavesFocusElsewhere({ open: "mount", editor, tree, active: null })
        ).toBe(false);
      });

      it("takes focus on a later open when no field has it", () => {
        const { editor, tree, item } = page();
        expect(
          leavesFocusElsewhere({ open: "later", editor, tree, active: item })
        ).toBe(false);
        expect(
          leavesFocusElsewhere({
            open: "later",
            editor,
            tree,
            active: document.body,
          })
        ).toBe(false);
      });

      it("leaves focus in an open popover on a later open", () => {
        const { editor, tree, pick } = page();
        expect(
          leavesFocusElsewhere({ open: "later", editor, tree, active: pick })
        ).toBe(true);
      });

      it("takes focus from the explorer's tree inside a dialog on a later open", () => {
        const { editor, tree, item } = page();
        const sheet = document.createElement("div");
        sheet.setAttribute("role", "dialog");
        document.body.append(sheet);
        sheet.append(tree);
        expect(
          leavesFocusElsewhere({ open: "later", editor, tree, active: item })
        ).toBe(false);
      });

      it("leaves focus on a later open while nothing has it and the tree shows in a dialog", () => {
        // A rename or delete of the open file from the Files dropdown: focus
        // is on its dialog's submit, disabled while it runs, or already back
        // on <body>, and the editor taking it would close the tree
        const { editor, tree, button, pick } = page();
        const sheet = document.createElement("div");
        sheet.setAttribute("role", "dialog");
        document.body.append(sheet);
        sheet.append(tree);
        pick.setAttribute("disabled", "");
        expect(
          leavesFocusElsewhere({ open: "later", editor, tree, active: pick })
        ).toBe(true);
        expect(
          leavesFocusElsewhere({
            open: "later",
            editor,
            tree,
            active: document.body,
          })
        ).toBe(true);
        expect(
          // eslint-disable-next-line unicorn/no-null -- `document.activeElement` is null with nothing focused
          leavesFocusElsewhere({ open: "later", editor, tree, active: null })
        ).toBe(true);
        // A control outside it still lets the editor take focus
        expect(
          leavesFocusElsewhere({ open: "later", editor, tree, active: button })
        ).toBe(false);
      });

      it("takes focus from a dialog's button disabled under it, as from the bare document", () => {
        // A submit disables its button while it runs (Rename's opens the
        // renamed file); Firefox keeps focus on it, Chromium drops it to <body>
        const { editor, tree, pick } = page();
        pick.setAttribute("disabled", "");
        expect(
          leavesFocusElsewhere({ open: "later", editor, tree, active: pick })
        ).toBe(false);
        expect(
          leavesFocusElsewhere({ open: "mount", editor, tree, active: pick })
        ).toBe(false);
      });

      it("takes focus when the editor already has it", () => {
        const { editor, tree, inputarea } = page();
        expect(
          leavesFocusElsewhere({
            open: "later",
            editor,
            tree,
            active: inputarea,
          })
        ).toBe(false);
      });

      it("leaves focus where it is while the editor is off the screen", () => {
        const { editor, tree } = page();
        const at = (left: number) =>
          vi
            .spyOn(editor, "getBoundingClientRect")
            .mockReturnValue(new DOMRect(left, 0, window.innerWidth, 400));
        at(-window.innerWidth / 2);
        expect(
          leavesFocusElsewhere({
            open: "mount",
            editor,
            tree,
            active: document.body,
          })
        ).toBe(true);
        at(window.innerWidth);
        expect(
          leavesFocusElsewhere({
            open: "later",
            editor,
            tree,
            active: document.body,
          })
        ).toBe(true);
        at(0);
        expect(
          leavesFocusElsewhere({
            open: "mount",
            editor,
            tree,
            active: document.body,
          })
        ).toBe(false);
      });

      it("leaves focus while off the screen even from the tree's item", () => {
        const { editor, tree, item } = page();
        vi.spyOn(editor, "getBoundingClientRect").mockReturnValue(
          new DOMRect(window.innerWidth, 0, window.innerWidth, 400)
        );
        expect(
          leavesFocusElsewhere({ open: "mount", editor, tree, active: item })
        ).toBe(true);
      });

      it("takes focus while off the screen outside the phone's pager", () => {
        const { editor, tree } = page();
        // Out of the pager, as the wide frame holds it
        document.body.append(editor);
        vi.spyOn(editor, "getBoundingClientRect").mockReturnValue(
          new DOMRect(window.innerWidth, 0, window.innerWidth, 400)
        );
        expect(
          leavesFocusElsewhere({
            open: "mount",
            editor,
            tree,
            active: document.body,
          })
        ).toBe(false);
      });

      it("takes focus when the editor is hidden, with an empty box", () => {
        const { editor, tree } = page();
        vi.spyOn(editor, "getBoundingClientRect").mockReturnValue(
          new DOMRect(0, 0, 0, 0)
        );
        expect(
          leavesFocusElsewhere({
            open: "mount",
            editor,
            tree,
            active: document.body,
          })
        ).toBe(false);
      });

      it("leaves focus in a field on a later open when the tree is not drawn", () => {
        const { editor, composer } = page();
        expect(
          leavesFocusElsewhere({
            open: "later",
            editor,
            tree: null,
            active: composer,
          })
        ).toBe(true);
      });
    });
  });
}
