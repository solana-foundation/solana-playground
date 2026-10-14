import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/shared/ui/sidebar";
import { TooltipProvider } from "@/shared/ui/tooltip";
import type { NavItem } from "../model/nav-item";
import BaseAppNav from "./BaseAppNav";

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

const draw = (collapsed: boolean, onOpen = vi.fn(), onToggle = vi.fn()) => {
  render(
    <TooltipProvider>
      <SidebarProvider>
        <BaseAppNav
          collapsed={collapsed}
          onToggle={onToggle}
          onOpen={onOpen}
          logo={<span>logo</span>}
          switcher={<span>switcher</span>}
          footer={<span>footer</span>}
          railFooter={<span>rail footer</span>}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
};

it("renders the four items and reports each pick", () => {
  const onOpen = vi.fn();
  draw(false, onOpen);
  const picks: [string, NavItem][] = [
    ["Home", "home"],
    ["New project", "new-project"],
    ["Tutorials", "tutorials"],
    ["Programs", "programs"],
  ];
  for (const [label, item] of picks) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onOpen).toHaveBeenLastCalledWith(item);
  }
  expect(onOpen).toHaveBeenCalledTimes(4);
});

it("shows the logo, switcher and footer when open, not the rail's", () => {
  draw(false);
  expect(screen.getByText("switcher")).toBeTruthy();
  expect(screen.getByText("footer")).toBeTruthy();
  expect(screen.getByText("logo")).toBeTruthy();
  expect(screen.queryByText("rail footer")).toBeNull();
});

it("swaps the logo, switcher and footer for the rail's footer when collapsed, keeping the items", () => {
  draw(true);
  expect(screen.queryByText("logo")).toBeNull();
  expect(screen.queryByText("switcher")).toBeNull();
  expect(screen.queryByText("footer")).toBeNull();
  expect(screen.getByText("rail footer")).toBeTruthy();
  for (const label of ["Home", "New project", "Tutorials", "Programs"]) {
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
  }
});

it("names the toggle for what it will do", () => {
  const onToggle = vi.fn();
  draw(false, vi.fn(), onToggle);
  fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
  expect(onToggle).toHaveBeenCalledTimes(1);
});

it("offers to expand a collapsed navigation", () => {
  const onToggle = vi.fn();
  draw(true, vi.fn(), onToggle);
  fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
  expect(onToggle).toHaveBeenCalledTimes(1);
});
