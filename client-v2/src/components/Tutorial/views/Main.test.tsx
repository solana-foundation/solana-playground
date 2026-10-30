import { render } from "@testing-library/react";
import { DefaultTheme, ThemeProvider } from "styled-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { Main } from "./Main";

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../../utils", () => ({
  PgCommon: { transition: (cb: () => unknown) => cb() },
  PgRouter: { location: { pathname: "/tutorials/test/1" } },
  PgTheme: { convertToCSS: () => "" },
  PgTutorial: { openPage: vi.fn(), finish: vi.fn() },
  PgView: { setSidebarLoading: vi.fn() },
}));
vi.mock("../../../hooks", () => ({ useAsyncEffect: () => {} }));

// The editor, the resizable pane and the Markdown renderer sit on the
// "editor-content" layout and on string content, which these pages avoid.
vi.mock("../../EditorWithTabs", () => ({ default: () => null }));
vi.mock("../../Markdown", () => ({ default: () => null }));
vi.mock("../../Resizable", () => ({ default: () => null }));
vi.mock("../../Loading", () => ({ SpinnerWithBg: () => null }));
vi.mock("../../Icons", () => ({ PointedArrow: () => null }));

// Every theme path the styled wrappers read answers with the same stand-in,
// which reads as an empty string where a style interpolates it
const theme: DefaultTheme = new Proxy({} as DefaultTheme, {
  get: (_, key) =>
    key === "toString" || key === Symbol.toPrimitive ? () => "" : theme,
});

type Pages = Parameters<typeof Main>[0]["pages"];

const renderAt = (pages: Pages, pageNumber: number) => {
  const view = (page: number) => (
    <ThemeProvider theme={theme}>
      <Main
        pages={pages}
        pageNumber={page}
        layout="content-only"
        isStarted
        start={async () => {}}
      />
    </ThemeProvider>
  );
  const { rerender, unmount } = render(view(pageNumber));
  return { openPage: (page: number) => rerender(view(page)), unmount };
};

/** React's warning for an effect that returns something other than a cleanup */
const cleanupWarnings = (error: MockInstance<typeof console.error>) =>
  error.mock.calls.filter((call) =>
    String(call[0]).includes("must not return anything besides a function")
  );

describe("Main page hooks", () => {
  let error: MockInstance<typeof console.error>;
  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    // jsdom has no scrolling, and `Main` scrolls to the top on page change
    Element.prototype.scrollTo = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it("does not take a value or a promise a page hook returns for a cleanup", () => {
    const sidebar = { name: "" };
    const assigns = vi.fn(() => (sidebar.name = "Build & Deploy"));
    const isAsync = vi.fn(async () => {});
    const pages: Pages = [
      { content: <p>One</p> },
      { content: <p>Two</p>, onMount: assigns },
      { content: <p>Three</p>, onMount: isAsync },
    ];

    const { openPage, unmount } = renderAt(pages, 2);
    openPage(3);
    openPage(1);
    unmount();

    expect(assigns).toHaveBeenCalledTimes(1);
    expect(isAsync).toHaveBeenCalledTimes(1);
    expect(cleanupWarnings(error)).toEqual([]);
  });

  it("runs a function a page hook returns when the learner leaves the page", () => {
    const cleanup = vi.fn();
    const pages: Pages = [
      { content: <p>One</p>, onMount: () => cleanup },
      { content: <p>Two</p> },
    ];

    const { openPage } = renderAt(pages, 1);
    expect(cleanup).not.toHaveBeenCalled();

    openPage(2);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
