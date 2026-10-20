import { render } from "@testing-library/react";
import { useRef } from "react";
import { ThemeProvider, type DefaultTheme } from "styled-components";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PgExplorer } from "../../../../utils";
import { forgetTree } from "./kept-tree";
import { useHandleItemState } from "./useHandleItemState";

/** What the mocked explorer reports; each test sets its own */
const given = vi.hoisted(() => ({ workspace: "w1" as string | undefined }));

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../../../utils", () => ({
  PgView: { classNames: { FOLDER: "folder", OPEN: "open" } },
  PgCommon: { sleep: () => new Promise(() => {}) },
  PgExplorer: {
    get currentWorkspaceId() {
      return given.workspace;
    },
    getElFromPath: (path: string) =>
      document.querySelector(`[data-path='${path}']`) ?? undefined,
    openFolder: vi.fn((el: HTMLElement) => el.classList.add("open")),
    onDidSwitchWorkspace: () => ({ dispose: () => {} }),
    onDidOpenFile: () => ({ dispose: () => {} }),
  },
}));

const theme = { name: "test" } as unknown as DefaultTheme;

/** A tree with `/w1/src/` closed, or open when `open` is given */
const Tree = ({ open }: { open?: boolean }) => {
  const ref = useRef<HTMLDivElement>(null);
  useHandleItemState(ref);
  return (
    <div ref={ref} id="root-dir">
      <div className={open ? "folder open" : "folder"} data-path="/w1/src/" />
    </div>
  );
};

const draw = (open?: boolean) =>
  render(
    <ThemeProvider theme={theme}>
      <Tree open={open} />
    </ThemeProvider>
  );

const srcIsOpen = () =>
  document.querySelector("[data-path='/w1/src/']")!.classList.contains("open");

// Before, not after: Testing Library unmounts the last tree after this file's
// own `afterEach`, and that unmount keeps it again
beforeEach(() => {
  forgetTree();
  given.workspace = "w1";
  vi.mocked(PgExplorer.openFolder).mockClear();
});

describe("useHandleItemState across an unmount", () => {
  it("opens again the folders open when the tree unmounted", () => {
    draw(true).unmount();
    draw();
    expect(srcIsOpen()).toBe(true);
  });

  it("keeps for the project open when the tree unmounts", () => {
    // The tree can mount before the explorer has opened its project
    given.workspace = undefined;
    const first = draw(true);
    given.workspace = "w1";
    first.unmount();

    draw();
    expect(srcIsOpen()).toBe(true);
  });

  it("opens nothing for another project", () => {
    draw(true).unmount();
    given.workspace = "w2";
    draw();
    expect(PgExplorer.openFolder).not.toHaveBeenCalled();
  });

  it("keeps nothing while no project is open", () => {
    given.workspace = undefined;
    draw(true).unmount();
    draw();
    expect(PgExplorer.openFolder).not.toHaveBeenCalled();
  });
});
