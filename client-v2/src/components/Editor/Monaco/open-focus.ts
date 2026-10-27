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
 * write. The mount's open keeps focus wherever the user put it, a field or
 * a control: under load it lands late, after a click on the lesson band
 * already moved focus (the tree's field too: the new file the user is still
 * naming has not been created yet). It takes focus from the bare document,
 * so a fresh load lands in the editor, and from an item of the tree, whose
 * click opened the file with no tab open and so mounted the editor.
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
  if (!isTypingElsewhere(editor, active)) return false;
  return !(tree && active && tree.contains(active));
};

/** Focus sits on something outside the editor, not on the bare document */
const isFocusedElsewhere = (editor: Element, active: Element | null) =>
  !!active &&
  active !== document.body &&
  active !== document.documentElement &&
  !editor.contains(active);

if (import.meta.vitest) {
  const { describe, it, expect, afterEach } = import.meta.vitest;

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
        '<div id="editor"><textarea id="inputarea"></textarea></div>';
      const get = (id: string) => document.getElementById(id)!;
      return {
        editor: get("editor"),
        tree: get("root-dir"),
        name: get("name"),
        item: get("item"),
        composer: get("composer"),
        button: get("button"),
        inputarea: get("inputarea"),
      };
    };

    describe("leavesFocusElsewhere", () => {
      afterEach(() => {
        document.body.innerHTML = "";
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
