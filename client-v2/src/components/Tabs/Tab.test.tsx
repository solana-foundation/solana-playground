import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Tab from "./Tab";

// The utils barrel needs build-time globals the unit runner does not define.
const explorer = vi.hoisted(() => ({
  tabs: [] as string[],
  currentFilePath: "",
  getItemNameFromPath: (path: string) => path.split("/").pop(),
  openFile: vi.fn(),
  closeFile: vi.fn(),
}));
vi.mock("../../utils", () => ({
  PgExplorer: {
    get tabs() {
      return explorer.tabs;
    },
    get currentFilePath() {
      return explorer.currentFilePath;
    },
    getItemNameFromPath: explorer.getItemNameFromPath,
    openFile: explorer.openFile,
    closeFile: explorer.closeFile,
  },
}));

// The icons and the language icon are not what is under test.
vi.mock("../Icons", () => ({ Close: () => <svg aria-hidden /> }));
vi.mock("../LangIcon", () => ({ default: () => null }));

const TABS = ["/a.rs", "/b.rs", "/c.rs"];

beforeEach(() => {
  vi.clearAllMocks();
  explorer.tabs = TABS;
  explorer.currentFilePath = "/b.rs";
});

const openMenuOf = async (path: string, index: number) => {
  render(<Tab path={path} index={index} />);
  fireEvent.contextMenu(screen.getByTitle(path));
  await screen.findByRole("menu");
};

const closed = () =>
  explorer.closeFile.mock.calls.map((call: string[]) => call[0]);

describe("Tab root", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the sortable's bookkeeping off the DOM", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Tab
        path="/a.rs"
        index={0}
        Item={() => null}
        id="/other"
        sortable={{ index: 0 }}
      />
    );
    const root = screen.getByTitle("/a.rs");
    expect(root.hasAttribute("sortable")).toBe(false);
    expect(root.hasAttribute("item")).toBe(false);
    expect(root.id).toBe("/a.rs");
    expect(error).not.toHaveBeenCalled();
  });

  it("keeps the design system's slot name under the context menu", () => {
    render(<Tab path="/a.rs" index={0} />);
    expect(screen.getByTitle("/a.rs").getAttribute("data-slot")).toBe(
      "editor-tab"
    );
  });
});

describe("Tab context menu", () => {
  it("Close closes only this tab", async () => {
    await openMenuOf("/b.rs", 1);

    fireEvent.click(screen.getByRole("menuitem", { name: /^Close\s*Alt\+W/ }));

    expect(closed()).toEqual(["/b.rs"]);
  });

  it("Close others closes every tab but this one", async () => {
    await openMenuOf("/b.rs", 1);

    fireEvent.click(screen.getByRole("menuitem", { name: /Close others/ }));

    expect(closed()).toEqual(["/a.rs", "/c.rs"]);
  });

  it("Close to the right closes only the tabs after this one", async () => {
    await openMenuOf("/b.rs", 1);

    fireEvent.click(
      screen.getByRole("menuitem", { name: /Close to the right/ })
    );

    expect(closed()).toEqual(["/c.rs"]);
  });

  it("Close all closes every tab, this one included", async () => {
    await openMenuOf("/b.rs", 1);

    fireEvent.click(screen.getByRole("menuitem", { name: /Close all/ }));

    expect(closed()).toEqual(["/a.rs", "/b.rs", "/c.rs"]);
  });

  it("hides Close others when this is the only tab", async () => {
    explorer.tabs = ["/a.rs"];
    await openMenuOf("/a.rs", 0);

    expect(screen.queryByRole("menuitem", { name: /Close others/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Close all/ })).toBeTruthy();
  });

  it("hides Close to the right on the last tab", async () => {
    await openMenuOf("/c.rs", 2);

    expect(
      screen.queryByRole("menuitem", { name: /Close to the right/ })
    ).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Close others/ })).toBeTruthy();
  });

  it("shows every item on a tab in the middle", async () => {
    await openMenuOf("/b.rs", 1);

    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent)
    ).toEqual([
      "CloseAlt+W",
      "Close others",
      "Close to the right",
      "Close all",
    ]);
  });
});
