vi.mock("../CodeBlock", () => ({
  __esModule: true,
  default: ({ lang, children }: { lang?: string; children: string }) => (
    <pre data-testid="code-block" data-lang={lang}>
      {children}
    </pre>
  ),
}));

// The utils barrel reads generated globals that exist only in the built app,
// so it is replaced with the few members Markdown touches
vi.mock("../../utils", () => ({
  PgCommon: {
    joinPaths: vi.fn(),
    toKebabFromTitle: (s: string) => s.toLowerCase(),
  },
  PgRouter: { location: {}, onDidChangeHash: () => ({ dispose: () => {} }) },
  PgTheme: { convertToCSS: () => "", alpha: (color: string) => color },
}));
vi.mock("../Link", () => ({ __esModule: true, default: () => null }));
vi.mock("../Img", () => ({ __esModule: true, default: () => null }));
vi.mock("../Icons", () => ({ HyperLink: () => null }));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider, type DefaultTheme } from "styled-components";

import Markdown from "./Markdown";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("Markdown", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // StyledMarkdown reads theme keys, so the empty theme throws. The real
  // theme cannot be built here (its module needs the utils barrel), so this
  // is a stand-in with only the keys the styles read.
  const theme = {
    default: {
      borderRadius: "4px",
      transition: { duration: { short: "0s" }, type: "linear" },
    },
    colors: {
      default: {
        border: "var(--border)",
        primary: "var(--primary)",
        textSecondary: "var(--text-secondary)",
      },
      state: { hover: { bg: "var(--surface-hover)" } },
    },
    components: {
      markdown: {
        color: "var(--text-primary)",
        bg: "var(--surface-base)",
        subtleBg: "var(--surface-raised)",
      },
    },
    font: { code: { family: "monospace", size: { small: "1", medium: "2" } } },
  } as unknown as DefaultTheme;

  // react-markdown 9 hands `pre` one child where 8 handed an array; the
  // renderer has to find the code either way
  it("renders through CodeBlock with its language and text", async () => {
    await act(async () => {
      root.render(
        <ThemeProvider theme={theme}>
          <Markdown>{"```rust\nfn main() {}\n```"}</Markdown>
        </ThemeProvider>
      );
    });

    const block = container.querySelector('[data-testid="code-block"]');
    expect(block?.getAttribute("data-lang")).toBe("rust");
    expect(block?.textContent).toBe("fn main() {}\n");
  });

  // react-markdown 9 hands a lone text child to `h2` as a string, which the
  // header used to index as an array and so took only its first letter
  it("derives a linkable header id from the whole title", async () => {
    await act(async () => {
      root.render(
        <ThemeProvider theme={theme}>
          <Markdown linkable>{"## Getting"}</Markdown>
        </ThemeProvider>
      );
    });

    expect(container.querySelector("h2")?.id).toBe("mdgetting");
  });
});
