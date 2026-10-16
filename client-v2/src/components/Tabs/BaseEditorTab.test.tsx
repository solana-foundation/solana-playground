import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BaseEditorTab } from "./BaseEditorTab";

const setup = (current: boolean, menuOpen = false) => {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <BaseEditorTab
      path="/src/lib.rs"
      name="lib.rs"
      icon={<svg aria-hidden />}
      current={current}
      menuOpen={menuOpen}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
  return { onSelect, onClose };
};

describe("BaseEditorTab", () => {
  it("renders a tab with the file name", () => {
    setup(false);
    expect(screen.getByRole("tab", { name: "lib.rs" })).toBeTruthy();
  });

  it("takes aria-selected from current", () => {
    setup(true);
    expect(
      screen.getByRole("tab", { name: "lib.rs" }).getAttribute("aria-selected")
    ).toBe("true");
  });

  it("keeps id and title as the path", () => {
    setup(false);
    const root = screen.getByTitle("/src/lib.rs");
    expect(root.id).toBe("/src/lib.rs");
  });

  it("draws the drag's copy with no id, out of reach of the keyboard", () => {
    render(
      <BaseEditorTab
        path="/src/lib.rs"
        name="lib.rs"
        icon={null}
        current
        menuOpen={false}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        drag="overlay"
      />
    );
    const copy = screen.getByTitle("/src/lib.rs");
    expect(copy.hasAttribute("id")).toBe(false);
    expect(copy.hasAttribute("inert")).toBe(true);
  });

  // The trigger is the tab; a focusable root around it would put a second
  // control in the tab list, with the tab nested inside it
  it("draws the root as a frame: role presentation, not focusable", () => {
    setup(true);
    const root = screen.getByTitle("/src/lib.rs");
    expect(root.getAttribute("role")).toBe("presentation");
    expect(root.hasAttribute("tabindex")).toBe(false);
  });

  it("selects on a click on the tab", () => {
    const { onSelect, onClose } = setup(false);
    fireEvent.click(screen.getByRole("tab"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  // jsdom lays nothing out, so a click at the tab's left edge cannot be
  // placed; the padding that edge is drawn from sits on the trigger instead
  it("selects from the tab's left edge: the trigger owns the padding", () => {
    const { onSelect } = setup(false);
    const root = screen.getByTitle("/src/lib.rs");
    const trigger = screen.getByRole("tab");
    expect(root.className.split(" ")).toContain("pl-0");
    expect(root.className.split(" ")).not.toContain("pl-3");
    expect(root.className.split(" ")).not.toContain("gap-1");
    expect(trigger.className.split(" ")).toContain("pl-3");
    fireEvent.click(trigger);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("closes without selecting on a click on close", () => {
    const { onSelect, onClose } = setup(false);
    fireEvent.click(screen.getByRole("button", { name: "Close lib.rs" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not start a drag from a press on close", () => {
    const onMouseDown = vi.fn();
    render(
      <BaseEditorTab
        path="/a.rs"
        name="a.rs"
        icon={null}
        current={false}
        menuOpen={false}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onMouseDown={onMouseDown}
      />
    );
    fireEvent.mouseDown(screen.getByRole("button", { name: "Close a.rs" }));
    expect(onMouseDown).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("tab"));
    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });

  it("marks an open menu", () => {
    setup(false, true);
    expect(
      screen.getByTitle("/src/lib.rs").hasAttribute("data-menu-open")
    ).toBe(true);
  });
});
