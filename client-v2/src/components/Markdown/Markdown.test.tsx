vi.mock("../CodeBlock", () => ({
  __esModule: true,
  default: ({ lang, children }: { lang?: string; children: string }) => (
    <pre data-testid="code-block" data-lang={lang} data-type={typeof children}>
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

import { sectionsOf } from "@/shared/lib/markdown-sections";

import { DEFINITION_FILES } from "../../tutorials/_definitions/generated";
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

  // react-markdown 9 hands `pre` one child where 8 handed an array; the
  // renderer has to find the code either way
  it("renders through CodeBlock with its language and text", async () => {
    await act(async () => {
      root.render(<Markdown>{"```rust\nfn main() {}\n```"}</Markdown>);
    });

    const block = container.querySelector('[data-testid="code-block"]');
    expect(block?.getAttribute("data-lang")).toBe("rust");
    expect(block?.textContent).toBe("fn main() {}\n");
  });

  // A streamed answer shows a fence before its first line arrives: the
  // highlighter splits the text, and undefined took the whole page down
  it("gives CodeBlock empty text for a code block with no lines yet", async () => {
    await act(async () => {
      root.render(<Markdown>{"```rust\n```"}</Markdown>);
    });

    const block = container.querySelector('[data-testid="code-block"]');
    expect(block?.getAttribute("data-type")).toBe("string");
  });

  it("gives headings their site's ids with headingIds, and none without", async () => {
    const page =
      "# Program Structure\n\n## `#[derive(Accounts)]` macro\n\n## declare_id! macro";
    await act(async () => {
      root.render(<Markdown headingIds>{page}</Markdown>);
    });
    expect(
      Array.from(container.querySelectorAll("h1,h2")).map((h) => h.id)
    ).toEqual([
      "program-structure",
      "deriveaccounts-macro",
      "declare_id-macro",
    ]);

    await act(async () => {
      root.render(<Markdown>{page}</Markdown>);
    });
    expect(
      Array.from(container.querySelectorAll("h1,h2")).map((h) => h.id)
    ).toEqual(["", "", ""]);
  });

  // The assistant's context lists a page's sections from a scan of its
  // Markdown; the ids it writes must be the ones the rendered page carries
  it("gives every tutorial doc page the ids the context's scan predicts", async () => {
    const pages = Object.values(DEFINITION_FILES).flatMap((file) =>
      Object.values(file.docPages ?? {})
    );
    expect(pages.length).toBeGreaterThan(0);
    const renderPage = (markdown: string) =>
      act(async () => {
        root.render(<Markdown headingIds>{markdown}</Markdown>);
      });
    for (const markdown of pages) {
      await renderPage(markdown);
      const rendered = Array.from(
        container.querySelectorAll("h2,h3,h4,h5,h6")
      ).map((h) => ({ title: h.textContent, id: h.id }));
      expect(rendered).toEqual(sectionsOf(markdown));
    }
  });

  // react-markdown 9 hands a lone text child to `h2` as a string, which the
  // header used to index as an array and so took only its first letter
  it("derives a linkable header id from the whole title", async () => {
    await act(async () => {
      root.render(<Markdown linkable>{"## Getting"}</Markdown>);
    });

    expect(container.querySelector("h2")?.id).toBe("mdgetting");
  });
});
