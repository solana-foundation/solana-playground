import { afterEach, describe, expect, it } from "vitest";

import { leavesFocusElsewhere } from "./open-focus";

/**
 * The page the editor sits in: the explorer's tree with a new file's name
 * field and an item, the assistant's composer, and the editor's own
 * textarea
 */
const page = () => {
  document.body.innerHTML =
    '<div id="root-dir"><input id="name" /><div id="item" tabindex="0"></div></div>' +
    '<textarea id="composer"></textarea>' +
    '<div id="editor"><textarea id="inputarea"></textarea></div>';
  const get = (id: string) => document.getElementById(id)!;
  return {
    editor: get("editor"),
    tree: get("root-dir"),
    name: get("name"),
    item: get("item"),
    composer: get("composer"),
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
      leavesFocusElsewhere({ open: "later", editor, tree, active: composer })
    ).toBe(true);
  });

  it("leaves focus in the composer on the mount's open", () => {
    const { editor, tree, composer } = page();
    expect(
      leavesFocusElsewhere({ open: "mount", editor, tree, active: composer })
    ).toBe(true);
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
      leavesFocusElsewhere({ open: "later", editor, tree, active: inputarea })
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
