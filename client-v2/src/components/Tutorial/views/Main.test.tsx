import { render } from "@testing-library/react";
import { DefaultTheme, ThemeProvider } from "styled-components";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { MockInstance } from "vitest";

import { Main } from "./Main";

// The utils barrel needs build-time globals the unit runner does not define.
// The navigation buttons are the only part of `Main` here that reaches it.
vi.mock("../../../utils", () => ({
  PgTheme: { convertToCSS: () => "" },
  PgTutorial: { openPage: vi.fn(), finish: vi.fn() },
}));
vi.mock("../../../hooks", () => ({ useAsyncEffect: () => {} }));

// The test needs only the page effect: these components either draw nothing
// on a "content-only" page with JSX content (the editor, the resizable pane,
// the spinner, the Markdown renderer) or read the app theme (the arrow icon).
vi.mock("../../EditorWithTabs", () => ({ default: () => null }));
vi.mock("../../Markdown", () => ({ default: () => null }));
vi.mock("../../Resizable", () => ({ default: () => null }));
vi.mock("../../Loading", () => ({ SpinnerWithBg: () => null }));
vi.mock("../../Icons", () => ({ PointedArrow: () => null }));

// Every theme path the styled wrappers read answers with the same stand-in,
// which reads as an empty string where a style interpolates it.
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

describe("Main page hooks", () => {
  // jsdom has no scrolling, and `Main` scrolls to the top on page change
  beforeAll(() => {
    Object.defineProperty(Element.prototype, "scrollTo", {
      value: () => {},
      configurable: true,
    });
  });
  afterAll(() => {
    Reflect.deleteProperty(Element.prototype, "scrollTo");
  });

  // React reports a bad cleanup on the console; a passing run logs nothing.
  let error: MockInstance<typeof console.error>;
  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("does not take a value or a promise a page hook returns for a cleanup", () => {
    // Written as the tutorials write it: the arrow returns the assigned string
    const sidebar = { name: "" };
    const assigns = vi.fn(() => (sidebar.name = "Build & Deploy"));
    const isAsync = vi.fn(async () => {});
    const pages: Pages = [
      { content: <p>One</p> },
      { content: <p>Two</p>, onMount: assigns },
      { content: <p>Three</p>, onMount: isAsync },
    ];

    const { openPage, unmount } = renderAt(pages, 2);
    expect(() => {
      openPage(3);
      openPage(1);
      unmount();
    }).not.toThrow();

    expect(assigns).toHaveBeenCalledTimes(1);
    expect(isAsync).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
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
    expect(error).not.toHaveBeenCalled();
  });

  it("runs a function a page hook returns when Main unmounts on that page", () => {
    const cleanup = vi.fn();
    const pages: Pages = [{ content: <p>One</p>, onMount: () => cleanup }];

    const { unmount } = renderAt(pages, 1);
    unmount();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });
});
