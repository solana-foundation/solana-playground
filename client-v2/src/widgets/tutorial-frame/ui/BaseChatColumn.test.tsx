import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import BaseChatColumn from "./BaseChatColumn";
import type { BaseChatColumnProps } from "./BaseChatColumn";

const props = (
  over: Partial<BaseChatColumnProps> = {}
): BaseChatColumnProps => ({
  name: over.name ?? "Hello Anchor",
  onBack: over.onBack ?? vi.fn(),
  onStartOver: over.onStartOver,
  mac: over.mac ?? true,
  width: over.width ?? 420,
  min: over.min ?? 340,
  max: over.max ?? 560,
  onWidthChange: over.onWidthChange ?? vi.fn(),
  onWidthPick: over.onWidthPick ?? vi.fn(),
  onReset: over.onReset ?? vi.fn(),
  children: over.children ?? <p>feed</p>,
});

describe("BaseChatColumn", () => {
  it("draws the head: back to Tutorials, the name, and More", async () => {
    const onBack = vi.fn();
    render(<BaseChatColumn {...props({ onBack })} />);
    expect(screen.getByRole("heading", { name: "Hello Anchor" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Tutorials" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
    expect(screen.getByText("feed")).toBeTruthy();
  });

  it("sizes the column from its width", () => {
    render(<BaseChatColumn {...props({ width: 400 })} />);
    expect(
      screen.getByRole("complementary", { name: "Tutorial chat" }).style.width
    ).toBe("400px");
  });

  it("lists Start over and Keyboard shortcuts in More", async () => {
    render(<BaseChatColumn {...props()} />);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: "Start over…" })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "Keyboard shortcuts" })
    ).toBeTruthy();
  });

  it("offers Start over only once something can start over", async () => {
    render(<BaseChatColumn {...props()} />);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    expect(
      screen
        .getByRole("menuitem", { name: "Start over…" })
        .hasAttribute("data-disabled")
    ).toBe(true);
  });

  it("asks before starting over, and starts over on the answer", async () => {
    const onStartOver = vi.fn().mockResolvedValue(undefined);
    render(<BaseChatColumn {...props({ onStartOver })} />);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Start over…" })
    );
    expect(
      screen.getByRole("dialog", { name: "Start Hello Anchor over?" })
    ).toBeTruthy();
    expect(onStartOver).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(onStartOver).toHaveBeenCalledOnce();
  });

  it("lists every key in Keyboard shortcuts", async () => {
    render(<BaseChatColumn {...props()} />);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Keyboard shortcuts" })
    );
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog.textContent).toContain("Run the live action");
    expect(dialog.textContent).toContain("Previous and next step");
  });

  it("gives the handle its range and value", () => {
    render(<BaseChatColumn {...props({ width: 420 })} />);
    const handle = screen.getByRole("separator", {
      name: "Resize the chat column",
    });
    expect(handle.getAttribute("aria-valuemin")).toBe("340");
    expect(handle.getAttribute("aria-valuemax")).toBe("560");
    expect(handle.getAttribute("aria-valuenow")).toBe("420");
  });

  it("moves the edge by arrows, Home and End", () => {
    const onWidthPick = vi.fn();
    render(<BaseChatColumn {...props({ width: 420, onWidthPick })} />);
    const handle = screen.getByRole("separator");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyDown(handle, { key: "End" });
    expect(onWidthPick.mock.calls).toEqual([
      [436, "key"],
      [356, "key"],
      [340, "key"],
      [560, "key"],
    ]);
  });

  it("hands the width back to the window on a double click", () => {
    const onReset = vi.fn();
    render(<BaseChatColumn {...props({ onReset })} />);
    fireEvent.doubleClick(screen.getByRole("separator"));
    expect(onReset).toHaveBeenCalledOnce();
  });
});
