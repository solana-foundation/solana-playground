import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/shared/ui/sidebar";
import { TooltipProvider } from "@/shared/ui/tooltip";
import type { ProjectEntry } from "../model/project-entries";
import BaseProjectList from "./BaseProjectList";
import type { BaseProjectListProps } from "./BaseProjectList";

// The stock Sidebar reads the viewport through `matchMedia`, which jsdom lacks
beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const project = (
  name: string,
  pinned = false,
  marker: ProjectEntry["marker"] = null
): ProjectEntry => ({
  name,
  id: `id-${name}`,
  isLesson: false,
  pinned,
  marker,
});
const lesson = (name: string): ProjectEntry => ({
  name,
  id: `id-${name}`,
  isLesson: true,
  pinned: false,
  marker: null,
});

const alpha = project("alpha");
const beta = project("beta", true);
const hello = lesson("Hello Anchor");
const local = project("local", false, "this-browser");
const behind = project("behind", true, "not-synced");

type Handlers = Pick<
  BaseProjectListProps,
  "onAction" | "onRenameChange" | "onRenameCommit" | "onRenameCancel"
>;

const draw = (
  overrides: {
    renaming?: string;
    renameError?: string;
    projects?: ProjectEntry[];
  } = {}
): Handlers => {
  const handlers: Handlers = {
    onAction: vi.fn(),
    onRenameChange: vi.fn(),
    onRenameCommit: vi.fn(),
    onRenameCancel: vi.fn(),
  };
  render(
    <TooltipProvider>
      <SidebarProvider>
        <BaseProjectList
          projects={overrides.projects ?? [beta, alpha, hello]}
          current="alpha"
          renaming={overrides.renaming ?? null}
          renameError={overrides.renameError ?? null}
          onAction={handlers.onAction}
          onRenameChange={handlers.onRenameChange}
          onRenameCommit={handlers.onRenameCommit}
          onRenameCancel={handlers.onRenameCancel}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
  return handlers;
};

const openMenu = (name: string) => {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: `Actions for ${name}` }),
    { button: 0, ctrlKey: false }
  );
  return screen.getByRole("menu");
};

describe("BaseProjectList", () => {
  it("lists lessons among the projects, with no count, the open one marked", () => {
    draw();
    const projects = screen.getByRole("group", { name: "Projects" });
    expect(screen.queryByRole("group", { name: "Lessons" })).toBeNull();
    expect(
      within(projects)
        .getAllByRole("button", { name: /^(alpha|beta|Hello Anchor)$/ })
        .map((b) => b.textContent)
    ).toEqual(["beta", "alpha", "Hello Anchor"]);
    expect(within(projects).queryByText(/of 4/)).toBeNull();
    expect(
      within(projects)
        .getByRole("button", { name: "alpha" })
        .getAttribute("aria-current")
    ).toBe("page");
  });

  /** The prototype keeps the open project's "⋮" in view, not on hover only */
  it("shows the open project's actions without a hover", () => {
    draw();
    const hidden = (name: string) =>
      screen
        .getByRole("button", { name: `Actions for ${name}` })
        .className.includes("md:opacity-0");
    expect(hidden("alpha")).toBe(false);
    expect(hidden("beta")).toBe(true);
  });

  it("says where a project's work lives when it is not in the account", () => {
    draw({ projects: [behind, local, alpha] });
    const projects = screen.getByRole("group", { name: "Projects" });
    expect(within(projects).getByText("This browser")).toBeTruthy();
    expect(within(projects).getByText("Not synced")).toBeTruthy();
    // The row keeps its name; the marker is its description
    const description = (name: string) => {
      const id = within(projects)
        .getByRole("button", { name })
        .getAttribute("aria-describedby");
      return id ? document.getElementById(id)?.textContent : null;
    };
    expect(description("local")).toBe("This browser");
    expect(description("behind")).toBe("Not synced");
    expect(description("alpha")).toBeNull();
  });

  it("draws Not synced with a warning dot, beside the pin", () => {
    draw({ projects: [behind] });
    const marker = screen.getByText("Not synced").closest("[data-sync-marker]");
    expect(marker?.getAttribute("data-sync-marker")).toBe("not-synced");
    expect(
      marker
        ?.querySelector('[data-slot="status-dot"]')
        ?.getAttribute("data-variant")
    ).toBe("warning");
    expect(screen.getAllByTitle("Pinned")).toHaveLength(1);
  });

  it("marks no row that the account holds", () => {
    draw();
    expect(document.querySelector("[data-sync-marker]")).toBeNull();
  });

  it("marks a pinned row, whose menu offers Unpin", () => {
    draw();
    const projects = screen.getByRole("group", { name: "Projects" });
    expect(within(projects).getAllByTitle("Pinned")).toHaveLength(1);
    const menu = openMenu("beta");
    expect(within(menu).getByRole("menuitem", { name: /unpin/i })).toBeTruthy();
  });

  it("runs an item by its letter while the menu is open", () => {
    const { onAction } = draw();
    fireEvent.keyDown(openMenu("alpha"), { key: "d" });
    expect(onAction).toHaveBeenLastCalledWith(alpha, "duplicate", "key");
  });

  it.each([
    ["o", "open"],
    ["p", "pin"],
    ["r", "rename"],
    ["e", "export"],
    ["Backspace", "delete"],
    ["Delete", "delete"],
  ])("maps %s to %s", (key, action) => {
    const { onAction } = draw();
    fireEvent.keyDown(openMenu("alpha"), { key });
    expect(onAction).toHaveBeenLastCalledWith(alpha, action, "key");
  });

  it("takes the letter whatever its case: Shift or Caps Lock gives D", () => {
    const { onAction } = draw();
    fireEvent.keyDown(openMenu("alpha"), { key: "D", shiftKey: true });
    expect(onAction).toHaveBeenLastCalledWith(alpha, "duplicate", "key");
  });

  it("unpins a pinned row by P", () => {
    const { onAction } = draw();
    fireEvent.keyDown(openMenu("beta"), { key: "p" });
    expect(onAction).toHaveBeenLastCalledWith(beta, "unpin", "key");
  });

  it("runs a clicked item", () => {
    const { onAction } = draw();
    const menu = openMenu("alpha");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Rename alpha" })
    );
    expect(onAction).toHaveBeenLastCalledWith(alpha, "rename", "click");
  });

  it("gives a lesson no Rename and no Duplicate, by click or key", () => {
    const { onAction } = draw();
    const menu = openMenu("Hello Anchor");
    expect(
      within(menu).queryByRole("menuitem", { name: /rename/i })
    ).toBeNull();
    expect(
      within(menu).queryByRole("menuitem", { name: /duplicate/i })
    ).toBeNull();
    fireEvent.keyDown(menu, { key: "d" });
    fireEvent.keyDown(menu, { key: "r" });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("renames in the row: Enter commits, letters type", () => {
    const { onAction, onRenameCommit } = draw({ renaming: "alpha" });
    const field = screen.getByRole("textbox", { name: "Rename alpha" });
    fireEvent.keyDown(field, { key: "d" });
    fireEvent.change(field, { target: { value: "gamma" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onRenameCommit).toHaveBeenCalledWith(alpha, "gamma");
    expect(onAction).not.toHaveBeenCalled();
  });

  it("cancels a rename by Escape, once, though a blur follows", () => {
    const { onRenameCancel, onRenameCommit } = draw({ renaming: "alpha" });
    const field = screen.getByRole("textbox", { name: "Rename alpha" });
    fireEvent.change(field, { target: { value: "gamma" } });
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.blur(field);
    expect(onRenameCancel).toHaveBeenCalledTimes(1);
    expect(onRenameCommit).not.toHaveBeenCalled();
  });

  it("cancels a rename on a blur that changed nothing", () => {
    const { onRenameCancel } = draw({ renaming: "alpha" });
    fireEvent.blur(screen.getByRole("textbox", { name: "Rename alpha" }));
    expect(onRenameCancel).toHaveBeenCalledTimes(1);
  });

  it("commits a changed name on blur", () => {
    const { onRenameCommit } = draw({ renaming: "alpha" });
    const field = screen.getByRole("textbox", { name: "Rename alpha" });
    fireEvent.change(field, { target: { value: "gamma" } });
    fireEvent.blur(field);
    expect(onRenameCommit).toHaveBeenCalledWith(alpha, "gamma");
  });

  it("shows a rename error in place", () => {
    draw({ renaming: "alpha", renameError: "A project named beta exists." });
    const field = screen.getByRole("textbox", { name: "Rename alpha" });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe(
      "A project named beta exists."
    );
  });
});
