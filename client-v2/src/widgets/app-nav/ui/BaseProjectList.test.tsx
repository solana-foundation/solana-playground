import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/shared/ui/sidebar";
import { TooltipProvider } from "@/shared/ui/tooltip";

import type { ProjectEntry } from "../model/project-entries";
import type { BaseProjectListProps } from "./BaseProjectList";
import BaseProjectList from "./BaseProjectList";

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
  progress: null,
});
const lesson = (
  name: string,
  progress: ProjectEntry["progress"] = null
): ProjectEntry => ({
  name,
  id: `id-${name}`,
  isLesson: true,
  pinned: false,
  marker: null,
  progress,
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
    loading?: boolean;
    current?: string;
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
          loading={overrides.loading ?? false}
          current={overrides.current ?? "alpha"}
          renaming={overrides.renaming}
          renameError={overrides.renameError}
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
  it("marks a lesson's row with the tutorial glyph and a project's with the folder", () => {
    draw();
    const glyphOf = (name: string) =>
      screen
        .getByRole("button", { name })
        .querySelector("[data-glyph]")
        ?.getAttribute("data-glyph");
    expect(glyphOf("Hello Anchor")).toBe("lesson");
    expect(glyphOf("alpha")).toBe("project");
  });

  it("shows three skeleton rows and no project while loading", () => {
    draw({ loading: true });
    const group = screen.getByRole("group", { name: "Projects" });
    expect(
      group.querySelectorAll('[data-sidebar="menu-skeleton"]')
    ).toHaveLength(3);
    expect(within(group).queryByRole("button", { name: "alpha" })).toBeNull();
  });

  it("lists lessons among the projects, the open one marked", () => {
    draw();
    const projects = screen.getByRole("group", { name: "Projects" });
    expect(screen.queryByRole("group", { name: "Lessons" })).toBeNull();
    expect(
      within(projects)
        .getAllByRole("button", { name: /^(alpha|beta|Hello Anchor)$/ })
        .map((b) => b.textContent)
    ).toEqual(["beta", "alpha", "Hello Anchor"]);
    expect(
      within(projects)
        .getByRole("button", { name: "alpha" })
        .getAttribute("aria-current")
    ).toBe("page");
  });

  /** The prototype keeps the open project's "⋮" in view, not on hover only */
  it("shows the open project's actions without a hover", () => {
    draw({});
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

  it("shows a started lesson's page, describing its row by it", () => {
    draw({
      projects: [
        lesson("Hello Anchor", { state: "started", page: 3, pages: 5 }),
      ],
    });
    const row = screen.getByRole("button", { name: "Hello Anchor" });
    expect(screen.getByText("3 of 5")).toBeTruthy();
    const id = row.getAttribute("aria-describedby") ?? "";
    expect(
      id
        .split(" ")
        .map((part) => document.getElementById(part)?.textContent)
        .join(" ")
    ).toContain("Page 3 of 5");
  });

  it("shows a finished lesson's check, describing its row as completed", () => {
    draw({ projects: [lesson("Hello Anchor", { state: "completed" })] });
    const row = screen.getByRole("button", { name: "Hello Anchor" });
    expect(
      document.querySelector('[data-lesson-progress="completed"]')
    ).toBeTruthy();
    const id = row.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(id)?.textContent).toBe("Completed");
  });

  it("shows no progress on a project, nor on a lesson not read yet", () => {
    draw({ projects: [alpha, hello] });
    expect(document.querySelector("[data-lesson-progress]")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Hello Anchor" })
        .getAttribute("aria-describedby")
    ).toBeNull();
  });

  it("describes a lesson by its progress and its marker together", () => {
    const both: ProjectEntry = {
      name: "Hello Anchor",
      id: "id-Hello Anchor",
      isLesson: true,
      pinned: false,
      marker: "this-browser",
      progress: { state: "started", page: 2, pages: 4 },
    };
    draw({ projects: [both] });
    const ids = screen
      .getByRole("button", { name: "Hello Anchor" })
      .getAttribute("aria-describedby")
      ?.split(" ");
    expect(ids?.map((id) => document.getElementById(id)?.textContent)).toEqual([
      "This browser",
      "Page 2 of 4",
    ]);
  });

  it("keeps a long name clear of the marker, the page and the pin together", () => {
    const crowded: ProjectEntry = {
      name: "A lesson with a long name",
      id: "id-crowded",
      isLesson: true,
      pinned: true,
      marker: "not-synced",
      progress: { state: "started", page: 12, pages: 12 },
    };
    draw({ projects: [crowded] });
    const row = screen.getByRole("button", {
      name: "A lesson with a long name",
    });
    // In the row's line after the name, so the name truncates against them
    // and takes their room when they step aside
    expect(row.querySelector("[data-sync-marker]")).not.toBeNull();
    expect(row.querySelector("[data-lesson-progress]")).not.toBeNull();
    expect(row.querySelector('[title="Pinned"]')).not.toBeNull();
    expect(screen.getByText("A lesson with a long name").classList).toContain(
      "truncate"
    );
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
    draw({});
    const projects = screen.getByRole("group", { name: "Projects" });
    expect(within(projects).getAllByTitle("Pinned")).toHaveLength(1);
    const menu = openMenu("beta");
    expect(within(menu).getByRole("menuitem", { name: /unpin/i })).toBeTruthy();
  });

  it("runs an item by its letter while the menu is open", () => {
    const { onAction } = draw({});
    fireEvent.keyDown(openMenu("alpha"), { key: "d" });
    expect(onAction).toHaveBeenLastCalledWith(alpha, "duplicate", "key");
  });

  it.each([
    ["o", "open"],
    ["p", "pin"],
    ["r", "rename"],
    ["e", "export"],
    ["g", "share-gist"],
    ["Backspace", "delete"],
    ["Delete", "delete"],
  ])("maps %s to %s", (key, action) => {
    const { onAction } = draw({});
    fireEvent.keyDown(openMenu("alpha"), { key });
    expect(onAction).toHaveBeenLastCalledWith(alpha, action, "key");
  });

  it("takes the letter whatever its case: Shift or Caps Lock gives D", () => {
    const { onAction } = draw({});
    fireEvent.keyDown(openMenu("alpha"), { key: "D", shiftKey: true });
    expect(onAction).toHaveBeenLastCalledWith(alpha, "duplicate", "key");
  });

  it("unpins a pinned row by P", () => {
    const { onAction } = draw({});
    fireEvent.keyDown(openMenu("beta"), { key: "p" });
    expect(onAction).toHaveBeenLastCalledWith(beta, "unpin", "key");
  });

  it("runs a clicked item", () => {
    const { onAction } = draw({});
    const menu = openMenu("alpha");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Rename alpha" })
    );
    expect(onAction).toHaveBeenLastCalledWith(alpha, "rename", "click");
  });

  it("gives a lesson no Rename and no Duplicate, by click or key", () => {
    const { onAction } = draw({});
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

  it("offers Share on the open project's row, by click or key", () => {
    const { onAction } = draw({});
    fireEvent.click(
      within(openMenu("alpha")).getByRole("menuitem", { name: "Share alpha" })
    );
    expect(onAction).toHaveBeenLastCalledWith(alpha, "share-gist", "click");
  });

  it("offers no Share on a row that is not open, and G does nothing there", () => {
    const { onAction } = draw({});
    const menu = openMenu("beta");
    expect(within(menu).queryByRole("menuitem", { name: /share/i })).toBeNull();
    fireEvent.keyDown(menu, { key: "g" });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("offers Share on an open lesson's row too", () => {
    const { onAction } = draw({ current: "Hello Anchor" });
    fireEvent.keyDown(openMenu("Hello Anchor"), { key: "g" });
    expect(onAction).toHaveBeenLastCalledWith(hello, "share-gist", "key");
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
    draw({
      renaming: "alpha",
      renameError: "A project already has that name.",
    });
    const field = screen.getByRole("textbox", { name: "Rename alpha" });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe(
      "A project already has that name."
    );
  });
});
