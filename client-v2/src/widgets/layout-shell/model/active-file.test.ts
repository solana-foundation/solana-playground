import { beforeEach, describe, expect, it, vi } from "vitest";

const explorer = vi.hoisted(() => ({
  currentFilePath: undefined as string | undefined,
  getRootFolderEl: vi.fn<() => HTMLElement | null>(),
  getItemPathFromEl: (el: Element) => el.getAttribute("data-path"),
  setSelectedEl: vi.fn(),
}));

vi.mock("@/utils", () => ({
  PgExplorer: explorer,
  PgCommon: { isPathsEqual: (a: string, b: string) => a === b },
}));

import { selectActiveFile } from "./active-file";

const tree = () => {
  const root = document.createElement("div");
  root.innerHTML = `
    <div data-path="/src/"></div>
    <div data-path="/src/lib.rs"></div>
    <div data-path="/tests/"></div>`;
  return root;
};

describe("selectActiveFile", () => {
  beforeEach(() => {
    explorer.setSelectedEl.mockClear();
    explorer.getRootFolderEl.mockReturnValue(tree());
  });

  it("selects the active file's row, whatever was selected before", () => {
    explorer.currentFilePath = "/src/lib.rs";
    selectActiveFile();
    expect(explorer.setSelectedEl).toHaveBeenCalledTimes(1);
    expect(
      explorer.setSelectedEl.mock.calls[0][0].getAttribute("data-path")
    ).toBe("/src/lib.rs");
  });

  it("leaves the selection with no active file", () => {
    explorer.currentFilePath = undefined;
    selectActiveFile();
    expect(explorer.setSelectedEl).not.toHaveBeenCalled();
  });

  it("leaves the selection when the tree has no row for the file", () => {
    explorer.currentFilePath = "/src/gone.rs";
    selectActiveFile();
    expect(explorer.setSelectedEl).not.toHaveBeenCalled();
  });
});
