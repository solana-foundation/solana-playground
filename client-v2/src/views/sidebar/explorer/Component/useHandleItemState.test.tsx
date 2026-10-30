import { render } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PgExplorer } from "../../../../utils";
import { forgetTree } from "./kept-tree";
import { useHandleItemState } from "./useHandleItemState";

/** What the mocked explorer reports; each test sets its own */
const given = vi.hoisted(() => ({
  workspace: "w1" as string | undefined,
  file: null as string | null,
}));

/** The explorer's listeners, for a test to fire as the explorer would */
const fire = vi.hoisted(() => ({
  openFile: (_file: { path: string } | null) => {},
  switchWorkspace: () => {},
}));

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../../../utils", () => ({
  PgView: { classNames: { FOLDER: "folder", OPEN: "open" } },
  PgExplorer: {
    get currentWorkspaceId() {
      return given.workspace;
    },
    get currentFilePath() {
      return given.file;
    },
    getElFromPath: (path: string) =>
      document.querySelector(`[data-path='${path}']`) ?? undefined,
    openFolder: vi.fn((el: HTMLElement) => el.classList.add("open")),
    // One level is enough for these trees: a file sits right under `src/`
    openAllParents: (path: string) =>
      document
        .querySelector(`[data-path='${path.replace(/[^/]+$/, "")}']`)
        ?.classList.add("open"),
    collapseAllFolders: () =>
      document
        .querySelectorAll(".folder")
        .forEach((el) => el.classList.remove("open")),
    setSelectedEl: vi.fn(),
    removeCtxSelectedEl: vi.fn(),
    onDidSwitchWorkspace: (cb: () => void) => {
      fire.switchWorkspace = cb;
      return { dispose: () => {} };
    },
    // Like the explorer's, it replays the open file as it subscribes
    onDidOpenFile: (cb: (file: { path: string } | null) => void) => {
      fire.openFile = cb;
      cb(given.file === null ? null : { path: given.file });
      return { dispose: () => {} };
    },
  },
}));

// The hook only reads the theme name, to resubscribe when the theme changes
vi.mock("@/shared/lib/hooks/use-pg-theme", () => ({
  usePgTheme: () => ({ name: "test" }),
}));

/**
 * The tree of `workspace` (`w1` by default): its `src/`, closed or open when
 * `open` is given, holding `lib.rs`; no tree at all for `null`, as before a
 * project's files have been drawn
 */
const Tree = ({
  open,
  workspace = "w1",
}: {
  open?: boolean;
  workspace?: string | null;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useHandleItemState(ref);
  return (
    <div ref={ref} id="root-dir">
      {workspace && (
        <>
          <div
            className={open ? "folder open" : "folder"}
            data-path={`/${workspace}/src/`}
          />
          <div data-path={`/${workspace}/src/lib.rs`} />
        </>
      )}
    </div>
  );
};

const draw = (open?: boolean) => render(<Tree open={open} />);

const srcIsOpen = (workspace = "w1") =>
  document
    .querySelector(`[data-path='/${workspace}/src/']`)!
    .classList.contains("open");

// Before, not after: Testing Library unmounts the last tree after this file's
// own `afterEach`, and that unmount keeps it again
beforeEach(() => {
  forgetTree();
  given.workspace = "w1";
  given.file = null;
  vi.mocked(PgExplorer.openFolder).mockClear();
  vi.mocked(PgExplorer.setSelectedEl).mockClear();
  vi.mocked(PgExplorer.removeCtxSelectedEl).mockClear();
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

describe("useHandleItemState when a project opens", () => {
  /** Opens a file, or closes the last one for `null`, as the explorer does */
  const openFile = (path: string | null) => {
    given.file = path;
    fire.openFile(path === null ? null : { path });
  };

  const libEl = (workspace: string) =>
    document.querySelector(`[data-path='/${workspace}/src/lib.rs']`);

  // `PgExplorer.switchWorkspace` announces the open file, then the switch,
  // and React draws the new project's tree some time after both: on a loaded
  // machine, after any fixed wait
  it("opens the open file's folder once the tree that holds it is drawn", () => {
    const view = render(<Tree workspace={null} />);
    openFile("/w2/src/lib.rs");
    fire.switchWorkspace();

    view.rerender(<Tree workspace="w2" />);
    expect(srcIsOpen("w2")).toBe(true);
    expect(PgExplorer.setSelectedEl).toHaveBeenCalledWith(libEl("w2"));
  });

  it("opens it again after the switch shuts a tree already drawn", () => {
    render(<Tree workspace="w2" />);
    openFile("/w2/src/lib.rs");
    fire.switchWorkspace();

    expect(srcIsOpen("w2")).toBe(true);
  });

  it("opens the folder of a file already open as the tree mounts", () => {
    given.file = "/w1/src/lib.rs";
    draw();
    expect(srcIsOpen()).toBe(true);
  });

  it("opens it once: a folder the user shuts stays shut", () => {
    const view = render(<Tree workspace={null} />);
    openFile("/w2/src/lib.rs");
    view.rerender(<Tree workspace="w2" />);

    document.querySelector("[data-path='/w2/src/']")!.classList.remove("open");
    view.rerender(<Tree workspace="w2" />);
    expect(srcIsOpen("w2")).toBe(false);
  });

  // A reveal that waited on the tree comes renders after the open, and a
  // context menu the user opened since owns the context selection
  it("keeps the context selection when the reveal waited on the tree", () => {
    const view = render(<Tree workspace={null} />);
    openFile("/w2/src/lib.rs");
    view.rerender(<Tree workspace="w2" />);

    expect(PgExplorer.removeCtxSelectedEl).not.toHaveBeenCalled();
  });

  it("clears the context selection when the file opens in a drawn tree", () => {
    render(<Tree workspace="w2" />);
    openFile("/w2/src/lib.rs");

    expect(PgExplorer.removeCtxSelectedEl).toHaveBeenCalledTimes(1);
  });

  it("opens nothing for a file closed before its tree was drawn", () => {
    const view = render(<Tree workspace={null} />);
    openFile("/w1/src/lib.rs");
    openFile(null);
    fire.switchWorkspace();

    view.rerender(<Tree workspace="w1" />);
    expect(srcIsOpen()).toBe(false);
  });
});
