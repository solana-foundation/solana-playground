import { fireEvent, render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import { describe, expect, it, vi } from "vitest";

import BaseAnswer from "./BaseAnswer";

// The app's Markdown reads the build's globals; the library under it draws
// the same links
vi.mock("@/components/Markdown", () => ({
  default: ({ children }: { children: string }) => (
    <ReactMarkdown>{children}</ReactMarkdown>
  ),
}));

const REPLY =
  "See the [IDL](https://www.anchor-lang.com/docs/basics/idl) and [Rust](https://www.rust-lang.org).";

/** Whether the press went on to open the link; `fireEvent` says false once prevented */
const opens = (name: string, init: MouseEventInit) =>
  fireEvent.click(screen.getByRole("link", { name }), init);

describe("BaseAnswer", () => {
  it("keeps a link the panel shows, and lets any other open", () => {
    const onLink = vi.fn((href: string) => href.includes("idl"));
    render(<BaseAnswer text={REPLY} tone="reply" onLink={onLink} />);
    expect(opens("IDL", {})).toBe(false);
    expect(onLink).toHaveBeenCalledWith(
      "https://www.anchor-lang.com/docs/basics/idl"
    );
    expect(opens("Rust", {})).toBe(true);
  });

  it("lets a link open when the panel could not show it", () => {
    render(<BaseAnswer text={REPLY} tone="reply" onLink={() => false} />);
    expect(opens("IDL", {})).toBe(true);
  });

  it("leaves a press with a modifier to the browser", () => {
    const onLink = vi.fn(() => true);
    render(<BaseAnswer text={REPLY} tone="reply" onLink={onLink} />);
    expect(opens("IDL", { ctrlKey: true })).toBe(true);
    expect(opens("IDL", { metaKey: true })).toBe(true);
    expect(opens("IDL", { altKey: true })).toBe(true);
    expect(opens("IDL", { shiftKey: true })).toBe(true);
    expect(onLink).not.toHaveBeenCalled();
  });

  it("opens every link as usual with no handler", () => {
    render(<BaseAnswer text={REPLY} tone="reply" />);
    expect(opens("IDL", {})).toBe(true);
  });
});
