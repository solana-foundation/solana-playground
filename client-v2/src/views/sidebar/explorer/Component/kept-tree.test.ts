import { afterEach, describe, expect, it, vi } from "vitest";

import {
  forgetTree,
  keepTree,
  keptFolders,
  openFolderPaths,
  reopenFolders,
} from "./kept-tree";

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../../../utils", () => ({
  PgView: { classNames: { FOLDER: "folder", OPEN: "open" } },
}));

/** A tree with `/src/` open and `/tests/` closed, as the explorer draws it */
const tree = () => {
  const root = document.createElement("div");
  root.innerHTML = `
    <div class="folder open" data-path="/src/"></div>
    <div class="folder-inside"></div>
    <div class="folder" data-path="/tests/"></div>
    <div class="file open" data-path="/src/lib.rs"></div>
  `;
  return root;
};

afterEach(forgetTree);

describe("kept-tree", () => {
  it("lists only open folders", () => {
    expect(openFolderPaths(tree())).toEqual(["/src/"]);
  });

  it("keeps for one project", () => {
    keepTree("a", tree());
    expect(keptFolders("a")).toEqual(["/src/"]);
    expect(keptFolders("b")).toEqual([]);
  });

  it("forgets", () => {
    keepTree("a", tree());
    forgetTree();
    expect(keptFolders("a")).toEqual([]);
  });

  it("skips a path that is gone", () => {
    const src = document.createElement("div");
    const find = (path: string) => (path === "/src/" ? src : undefined);
    const open = vi.fn();
    reopenFolders(["/gone/", "/src/"], find, open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(src);
  });
});
