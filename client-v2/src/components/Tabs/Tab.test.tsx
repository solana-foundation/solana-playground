import { fireEvent, render, screen } from "@testing-library/react";
import { DefaultTheme, ThemeProvider } from "styled-components";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  PgTheme: { convertToCSS: () => "" },
}));

// The icons, the button and the language icon are styled-components that read
// the app theme; they are not what is under test.
vi.mock("../Icons", () => ({ Close: () => <svg aria-hidden /> }));
vi.mock("../LangIcon", () => ({ default: () => null }));
vi.mock("../Button", async () => {
  const { forwardRef } = await import("react");
  return {
    default: forwardRef<HTMLButtonElement>((props, ref) => (
      <button type="button" ref={ref} {...props} />
    )),
  };
});

// Every theme path the styled wrapper reads answers with the same stand-in
const theme: DefaultTheme = new Proxy({} as DefaultTheme, { get: () => theme });

const TABS = ["/a.rs", "/b.rs", "/c.rs"];

beforeEach(() => {
  vi.clearAllMocks();
  explorer.tabs = TABS;
  explorer.currentFilePath = "/b.rs";
});

const openMenuOf = async (path: string, index: number) => {
  render(
    <ThemeProvider theme={theme}>
      <Tab path={path} index={index} />
    </ThemeProvider>
  );
  fireEvent.contextMenu(screen.getByTitle(path));
  await screen.findByRole("menu");
};

const closed = () =>
  explorer.closeFile.mock.calls.map((call: string[]) => call[0]);

describe("Tab context menu", () => {
  it("Close closes only this tab", async () => {
    await openMenuOf("/b.rs", 1);

    fireEvent.click(screen.getByRole("menuitem", { name: /^Close\s*ALT\+W/ }));

    expect(closed()).toEqual(["/b.rs"]);
  });

  it("Close Others closes every tab but this one", async () => {
    await openMenuOf("/b.rs", 1);

    fireEvent.click(screen.getByRole("menuitem", { name: /Close Others/ }));

    expect(closed()).toEqual(["/a.rs", "/c.rs"]);
  });

  it("Close To The Right closes only the tabs after this one", async () => {
    await openMenuOf("/b.rs", 1);

    fireEvent.click(
      screen.getByRole("menuitem", { name: /Close To The Right/ })
    );

    expect(closed()).toEqual(["/c.rs"]);
  });

  it("Close All closes every tab, this one included", async () => {
    await openMenuOf("/b.rs", 1);

    fireEvent.click(screen.getByRole("menuitem", { name: /Close All/ }));

    expect(closed()).toEqual(["/a.rs", "/b.rs", "/c.rs"]);
  });

  it("hides Close Others when this is the only tab", async () => {
    explorer.tabs = ["/a.rs"];
    await openMenuOf("/a.rs", 0);

    expect(screen.queryByRole("menuitem", { name: /Close Others/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Close All/ })).toBeTruthy();
  });

  it("hides Close To The Right on the last tab", async () => {
    await openMenuOf("/c.rs", 2);

    expect(
      screen.queryByRole("menuitem", { name: /Close To The Right/ })
    ).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Close Others/ })).toBeTruthy();
  });

  it("shows every item on a tab in the middle", async () => {
    await openMenuOf("/b.rs", 1);

    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent)
    ).toEqual([
      "CloseALT+W",
      "Close Others",
      "Close To The Right",
      "Close All",
    ]);
  });
});
