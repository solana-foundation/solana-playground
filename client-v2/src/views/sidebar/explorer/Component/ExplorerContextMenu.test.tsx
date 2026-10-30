import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { PgExplorer } from "../../../../utils";

import { ExplorerContextMenu } from "./ExplorerContextMenu";

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../../../utils", () => ({
  PgExplorer: { removeCtxSelectedEl: vi.fn() },
  PgView: { ids: { ROOT_DIR: "root-dir" } },
}));

const report = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/report-button-failure", () => ({
  reportButtonFailure: vi.fn(() => report),
}));

// The icons read the app theme through `PgTheme`; they are not what is under
// test.
vi.mock("../../../../components/Icons", () => {
  const Icon = () => <svg aria-hidden />;
  return {
    Edit: Icon,
    NewFile: Icon,
    NewFolder: Icon,
    Rocket: Icon,
    RunAll: Icon,
    TestPaper: Icon,
    TestTube: Icon,
    Trash: Icon,
    Triangle: Icon,
    Wrench: Icon,
  };
});

const makeProps = (handleMenu: () => boolean) => ({
  itemData: { isFolder: false },
  ctxNewItem: vi.fn(),
  renameItem: vi.fn(),
  deleteItem: vi.fn(),
  runBuild: vi.fn().mockResolvedValue(undefined),
  runDeploy: vi.fn().mockResolvedValue(undefined),
  runClient: vi.fn().mockResolvedValue(undefined),
  runClientFolder: vi.fn().mockResolvedValue(undefined),
  runTest: vi.fn().mockResolvedValue(undefined),
  runTestFolder: vi.fn().mockResolvedValue(undefined),
  handleMenu,
});

const renderMenu = (props: ReturnType<typeof makeProps>) =>
  render(
    <ExplorerContextMenu
      itemData={props.itemData}
      ctxNewItem={props.ctxNewItem}
      renameItem={props.renameItem}
      deleteItem={props.deleteItem}
      runBuild={props.runBuild}
      runDeploy={props.runDeploy}
      runClient={props.runClient}
      runClientFolder={props.runClientFolder}
      runTest={props.runTest}
      runTestFolder={props.runTestFolder}
      handleMenu={props.handleMenu}
    >
      <div data-testid="target">item</div>
    </ExplorerContextMenu>
  );

/** What the explorer's portal puts in the tree: an input under the root dir */
const mountRootInput = () => {
  const root = document.createElement("div");
  root.id = "root-dir";
  const input = document.createElement("input");
  root.appendChild(input);
  document.body.appendChild(root);
  return { input, remove: () => root.remove() };
};

describe("ExplorerContextMenu", () => {
  it("opens a menu of menuitems with shortcuts and runs the chosen one", async () => {
    const props = makeProps(() => true);
    renderMenu(props);

    fireEvent.contextMenu(screen.getByTestId("target"));

    const rename = await screen.findByRole("menuitem", { name: /Rename/ });
    expect(rename.textContent).toContain("F2");

    fireEvent.click(rename);

    expect(props.renameItem).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  type Handler =
    | "ctxNewItem"
    | "renameItem"
    | "deleteItem"
    | "runBuild"
    | "runDeploy"
    | "runClient"
    | "runClientFolder"
    | "runTest"
    | "runTestFolder";

  // `flag` is the `itemData` field that shows the item; null means it always shows
  const items: { flag: string | null; name: RegExp; handler: Handler }[] = [
    { flag: "isFolder", name: /New File/, handler: "ctxNewItem" },
    { flag: "isFolder", name: /New Folder/, handler: "ctxNewItem" },
    { flag: null, name: /Rename/, handler: "renameItem" },
    { flag: null, name: /Delete/, handler: "deleteItem" },
    { flag: "isProgramFolder", name: /Build/, handler: "runBuild" },
    { flag: "isProgramFolder", name: /Deploy/, handler: "runDeploy" },
    { flag: "isClient", name: /^Run$/, handler: "runClient" },
    { flag: "isClientFolder", name: /Run All/, handler: "runClientFolder" },
    { flag: "isTest", name: /^Test$/, handler: "runTest" },
    { flag: "isTestFolder", name: /Test All/, handler: "runTestFolder" },
  ];

  const itemDataWith = (flag: string | null) => ({
    isFolder: flag === "isFolder",
    isProgramFolder: flag === "isProgramFolder",
    isClient: flag === "isClient",
    isClientFolder: flag === "isClientFolder",
    isTest: flag === "isTest",
    isTestFolder: flag === "isTestFolder",
  });

  it.each(items)(
    "runs only $handler for $name when its flag ($flag) is on",
    async ({ flag, name, handler }) => {
      const props = makeProps(() => true);
      props.itemData = itemDataWith(flag);
      renderMenu(props);

      fireEvent.contextMenu(screen.getByTestId("target"));
      fireEvent.click(await screen.findByRole("menuitem", { name }));

      expect(props[handler]).toHaveBeenCalledTimes(1);
      for (const other of items) {
        if (other.handler !== handler) {
          expect(props[other.handler]).not.toHaveBeenCalled();
        }
      }
    }
  );

  it.each(items.filter((item) => item.flag !== null))(
    "hides $name when $flag is off",
    async ({ name }) => {
      const props = makeProps(() => true);
      props.itemData = itemDataWith(null);
      renderMenu(props);

      fireEvent.contextMenu(screen.getByTestId("target"));
      await screen.findByRole("menu");

      expect(screen.queryByRole("menuitem", { name })).toBeNull();
      // The always-present items prove the menu is open and not just empty
      expect(screen.getByRole("menuitem", { name: /Rename/ })).toBeTruthy();
    }
  );

  it("opens no menu when handleMenu declines the target", () => {
    const props = makeProps(() => false);
    renderMenu(props);

    const target = screen.getByTestId("target");
    const notPrevented = fireEvent.contextMenu(target);

    expect(screen.queryByRole("menu")).toBeNull();
    expect(notPrevented).toBe(false);
  });

  it("closes on Escape without running a handler and clears the selection", async () => {
    const props = makeProps(() => true);
    const clear = vi.mocked(PgExplorer.removeCtxSelectedEl);
    clear.mockClear();
    renderMenu(props);

    fireEvent.contextMenu(screen.getByTestId("target"));
    await screen.findByRole("menu");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(props.renameItem).not.toHaveBeenCalled();
    expect(props.deleteItem).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
  });

  it("closes on an outside press without running a handler and clears the selection", async () => {
    const props = makeProps(() => true);
    const clear = vi.mocked(PgExplorer.removeCtxSelectedEl);
    clear.mockClear();
    renderMenu(props);

    fireEvent.contextMenu(screen.getByTestId("target"));
    await screen.findByRole("menu");
    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(props.renameItem).not.toHaveBeenCalled();
    expect(props.deleteItem).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
  });

  it("focuses the new-item input after New File, not the trigger", async () => {
    const props = makeProps(() => true);
    props.itemData = { isFolder: true };
    // What the explorer's portal puts in the tree
    const root = mountRootInput();
    try {
      renderMenu(props);

      fireEvent.contextMenu(screen.getByTestId("target"));
      fireEvent.click(
        await screen.findByRole("menuitem", { name: /New File/ })
      );

      await waitFor(() => expect(document.activeElement).toBe(root.input));
    } finally {
      root.remove();
    }
  });

  it("leaves focus to Radix's return to the trigger after Rename and Delete, even with an input mounted", async () => {
    // The input is there, so only the `openedInput` guard keeps focus off it
    const root = mountRootInput();
    try {
      for (const name of [/Rename/, /Delete/]) {
        const props = makeProps(() => true);
        const { unmount } = renderMenu(props);
        const target = screen.getByTestId("target");
        // A right-click focuses the item first, as a browser does
        target.tabIndex = 0;
        target.focus();

        fireEvent.contextMenu(target);
        fireEvent.click(await screen.findByRole("menuitem", { name }));

        await waitFor(() => expect(document.activeElement).toBe(target));
        expect(document.activeElement).not.toBe(root.input);
        unmount();
      }
    } finally {
      root.remove();
    }
  });

  it("does not focus the input when the menu is reopened after New File and dismissed", async () => {
    const props = makeProps(() => true);
    props.itemData = { isFolder: true };
    const root = mountRootInput();
    try {
      renderMenu(props);
      const target = screen.getByTestId("target");
      target.tabIndex = 0;

      fireEvent.contextMenu(target);
      fireEvent.click(
        await screen.findByRole("menuitem", { name: /New File/ })
      );
      await waitFor(() => expect(document.activeElement).toBe(root.input));

      // `openedInput` resets on open, so this second close is a plain dismissal
      target.focus();
      fireEvent.contextMenu(target);
      fireEvent.keyDown(await screen.findByRole("menu"), { key: "Escape" });

      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(target));
      expect(document.activeElement).not.toBe(root.input);
    } finally {
      root.remove();
    }
  });

  it("tells the user when a run it started fails", async () => {
    const failure = new Error("test failed");
    const props = makeProps(() => true);
    props.itemData = { isFolder: false, isTest: true } as never;
    props.runTest.mockRejectedValue(failure);
    renderMenu(props);

    fireEvent.contextMenu(screen.getByTestId("target"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Test$/ }));

    await waitFor(() => expect(report).toHaveBeenCalledWith(failure));
    expect(reportButtonFailure).toHaveBeenCalledWith("run the test");
  });
});
