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
let sent: ReturnType<typeof memoryProvider>;
let logged: ReturnType<typeof memoryLogs>;
beforeEach(() => {
  // `setModal` settles when the modal closes
  view.setModal.mockReset().mockResolvedValue(null);
  onHome.mockReset();
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  logged = memoryLogs();
  initLogger({ providers: [logged] });
});
afterEach(() => {
  resetTelemetry();
  resetLogger();
});

const draw = () =>
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
        />
      </SidebarProvider>
    </TooltipProvider>
  );

const opened = () =>
  sent.events
    .filter((event) => event.name === "nav_item_opened")
    .map((event) => event.params);

it.each([
  ["New project", "new-project", "tutorials"],
  ["Tutorials", "tutorials", "tutorials"],
  ["Programs", "programs", "programs"],
])(
  "reports %s as the item picked and opens the gallery on its %s tab",
  (label, item, initialTab) => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(opened()).toEqual([{ item }]);
    expect(view.setModal).toHaveBeenCalledTimes(1);
    expect(view.setModal).toHaveBeenCalledWith(NewWorkspaceModal, {
      initialTab,
    });
  }
);

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

it("still opens the gallery from the other items", () => {
  draw();
  fireEvent.click(screen.getByRole("button", { name: "Programs" }));
  expect(view.setModal).toHaveBeenCalledTimes(1);
});
