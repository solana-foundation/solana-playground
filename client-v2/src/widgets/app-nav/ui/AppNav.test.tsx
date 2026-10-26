import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// The `@/utils` barrel needs a booted app; the nav uses only `PgView`
const view = vi.hoisted(() => ({ setModal: vi.fn() }));
vi.mock("@/utils", () => ({ PgView: view }));
// The gallery pulls in the legacy modal and the whole `@/utils` barrel; the
// nav only hands it to `PgView.setModal`
vi.mock("@/views/flow/gallery/NewWorkspaceModal", () => ({
  default: () => null,
}));

import NewWorkspaceModal from "@/views/flow/gallery/NewWorkspaceModal";
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
const pages = { open: vi.fn(), close: vi.fn() };
const closeSheet = vi.fn();
let sent: ReturnType<typeof memoryProvider>;
let logged: ReturnType<typeof memoryLogs>;
beforeEach(() => {
  // `setModal` settles when the modal closes
  view.setModal.mockReset().mockResolvedValue(null);
  onHome.mockReset();
  pages.open.mockReset();
  pages.close.mockReset();
  closeSheet.mockReset();
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  logged = memoryLogs();
  initLogger({ providers: [logged] });
});
afterEach(() => {
  resetTelemetry();
  resetLogger();
});

const draw = (current?: "tutorials" | "programs", homeShown = false) =>
  render(
    <TooltipProvider>
      <SidebarProvider>
        <AppNav
          collapsed={false}
          onToggle={() => {}}
          logo={null}
          projects={null}
          footer={null}
          railFooter={null}
          setup={null}
          onHome={onHome}
          current={current}
          homeShown={homeShown}
          onOpenPage={pages.open}
          onClosePage={pages.close}
          closeSheet={closeSheet}
        />
      </SidebarProvider>
    </TooltipProvider>
  );

const opened = () =>
  sent.events
    .filter((event) => event.name === "nav_item_opened")
    .map((event) => event.params);

it("reports New project as the item picked and opens the gallery", () => {
  draw();
  fireEvent.click(screen.getByRole("button", { name: "New project" }));
  expect(opened()).toEqual([{ item: "new-project" }]);
  expect(view.setModal).toHaveBeenCalledTimes(1);
  expect(view.setModal).toHaveBeenCalledWith(NewWorkspaceModal);
});

it.each([
  ["Tutorials", "tutorials"],
  ["Programs", "programs"],
] as const)("opens the %s page, and no gallery", (label, item) => {
  draw();
  fireEvent.click(screen.getByRole("button", { name: label }));
  expect(opened()).toEqual([{ item }]);
  expect(pages.open).toHaveBeenCalledWith(item);
  expect(view.setModal).not.toHaveBeenCalled();
});

// On a phone the gallery would open over the menu page, and the project it
// starts would open behind the menu
it("leaves the navigation before New project opens the gallery", () => {
  draw();
  fireEvent.click(screen.getByRole("button", { name: "New project" }));
  expect(closeSheet).toHaveBeenCalledTimes(1);
  expect(closeSheet.mock.invocationCallOrder[0]).toBeLessThan(
    view.setModal.mock.invocationCallOrder[0]
  );
});

it("closes the page shown before New project opens the gallery", () => {
  draw("tutorials");
  fireEvent.click(screen.getByRole("button", { name: "New project" }));
  expect(pages.close).toHaveBeenCalledTimes(1);
  expect(view.setModal).toHaveBeenCalledTimes(1);
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

it("opens Home, not the gallery, from the work", () => {
  draw();
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  expect(opened()).toEqual([{ item: "home" }]);
  expect(onHome).toHaveBeenCalledTimes(1);
  expect(view.setModal).not.toHaveBeenCalled();
});

it("hands every pick of Home to the page, which decides, and opens no gallery", () => {
  draw();
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  expect(onHome).toHaveBeenCalledTimes(2);
  expect(view.setModal).not.toHaveBeenCalled();
});

it("hands Home to the page over a page too, which closes it", () => {
  draw("programs");
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  expect(onHome).toHaveBeenCalledTimes(1);
  expect(view.setModal).not.toHaveBeenCalled();
});
