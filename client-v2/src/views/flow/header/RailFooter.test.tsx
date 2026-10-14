import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

import { PgSession } from "@/features/auth";
import { SidebarProvider } from "@/shared/ui/sidebar";
import { TooltipProvider } from "@/shared/ui/tooltip";
import RailFooter from "./RailFooter";

const status = vi.hoisted(() => ({ name: "devnet", down: false }));
vi.mock("./use-cluster-status", () => ({ useClusterStatus: () => status }));
// The utils barrel, which the hooks and the settings panel import, reads
// generated globals that exist only in the built app
vi.mock("@/hooks", () => ({ useRenderOnChange: () => undefined }));
vi.mock("../settings/GearSidebar", () => ({
  SETTINGS_TRIGGER_ATTR: "data-settings-trigger",
}));

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
afterEach(() => {
  vi.restoreAllMocks();
  status.down = false;
});

const draw = (onToggleSettings = vi.fn(), onExpand = vi.fn()) => {
  render(
    <TooltipProvider>
      <SidebarProvider defaultOpen={false}>
        <RailFooter
          settingsOpen={false}
          onToggleSettings={onToggleSettings}
          onExpand={onExpand}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
};

it("opens the settings on the cluster from the cluster's dot", () => {
  const onToggleSettings = vi.fn();
  draw(onToggleSettings);
  fireEvent.click(screen.getByRole("button", { name: "Cluster: devnet" }));
  expect(onToggleSettings).toHaveBeenCalledExactlyOnceWith("network");
});

it("says a cluster that is down in the dot's name, not by colour alone", () => {
  status.down = true;
  draw();
  expect(
    screen.getByRole("button", { name: "Cluster: devnet, down" })
  ).toBeTruthy();
});

it("expands the navigation from the account's button", () => {
  const onExpand = vi.fn();
  draw(vi.fn(), onExpand);
  fireEvent.click(screen.getByRole("button", { name: "Account" }));
  expect(onExpand).toHaveBeenCalledTimes(1);
});

it("shows the signed-in user's avatar on the account's button", () => {
  vi.spyOn(PgSession, "get").mockReturnValue({
    id: "u1",
    login: "octo",
    name: "Octo",
    image: "https://example.test/octo.png",
  });
  draw();
  const account = screen.getByRole("button", { name: "Account" });
  expect(account.querySelector("img")?.getAttribute("src")).toBe(
    "https://example.test/octo.png"
  );
});

it("shows a generic icon on the account's button when nobody is signed in", () => {
  vi.spyOn(PgSession, "get").mockReturnValue(null);
  draw();
  const account = screen.getByRole("button", { name: "Account" });
  expect(account.querySelector("img")).toBeNull();
  expect(account.querySelector("svg")).toBeTruthy();
});
