import { fireEvent, render, screen } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";

import {
  initLogger,
  memoryProvider as memoryLogs,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { SidebarProvider } from "@/shared/ui/sidebar";
import { TooltipProvider } from "@/shared/ui/tooltip";

// The `@/utils` barrel needs a booted app, and the nav uses none of it
vi.mock("@/utils", () => ({}));

import type { NavPage } from "./AppNav";
import AppNav from "./AppNav";

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

const onHome = vi.fn();
const pages = { open: vi.fn() };
let sent: ReturnType<typeof memoryProvider>;
let logged: ReturnType<typeof memoryLogs>;
beforeEach(() => {
  onHome.mockReset();
  pages.open.mockReset();
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  logged = memoryLogs();
  initLogger({ providers: [logged] });
});
afterEach(() => {
  resetTelemetry();
  resetLogger();
});

const draw = (current?: NavPage, homeShown = false) =>
  render(
    <TooltipProvider>
      <SidebarProvider>
        <AppNav
          collapsed={false}
          onToggle={() => {}}
          logo={null}
          railLogo={undefined}
          projects={() => null}
          footer={null}
          railFooter={null}
          setup={null}
          onHome={onHome}
          current={current}
          homeShown={homeShown}
          onOpenPage={pages.open}
        />
      </SidebarProvider>
    </TooltipProvider>
  );

const opened = () =>
  sent.events
    .filter((event) => event.name === "nav_item_opened")
    .map((event) => event.params);

it.each([
  ["New project", "new-project"],
  ["Tutorials", "tutorials"],
  ["Programs", "programs"],
] as const)("opens the %s page", (label, item) => {
  draw();
  fireEvent.click(screen.getByRole("button", { name: label }));
  expect(opened()).toEqual([{ item }]);
  expect(pages.open).toHaveBeenCalledWith(item);
});

it("marks New project as the current item while its page shows", () => {
  draw("new-project", true);
  expect(
    screen.getByRole("button", { name: "New project" }).dataset.active
  ).toBe("true");
  expect(screen.getByRole("button", { name: "Home" }).dataset.active).toBe(
    "false"
  );
});

it("marks the page shown as the current item", () => {
  draw("tutorials");
  const item = screen.getByRole("button", { name: "Tutorials" });
  expect(item.dataset.active).toBe("true");
  expect(screen.getByRole("button", { name: "Programs" }).dataset.active).toBe(
    "false"
  );
});

it("marks Home as the current item while Home shows", () => {
  draw(undefined, true);
  expect(screen.getByRole("button", { name: "Home" }).dataset.active).toBe(
    "true"
  );
});

it("marks the page, not Home, when a page covers Home", () => {
  draw("programs", true);
  expect(screen.getByRole("button", { name: "Home" }).dataset.active).toBe(
    "false"
  );
  expect(screen.getByRole("button", { name: "Programs" }).dataset.active).toBe(
    "true"
  );
});

it("opens Home from the work", () => {
  draw();
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  expect(opened()).toEqual([{ item: "home" }]);
  expect(onHome).toHaveBeenCalledTimes(1);
});

it("hands every pick of Home to the page, which decides", () => {
  draw();
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  expect(onHome).toHaveBeenCalledTimes(2);
});

it("hands Home to the page over a page too, which closes it", () => {
  draw("programs");
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  expect(onHome).toHaveBeenCalledTimes(1);
});
