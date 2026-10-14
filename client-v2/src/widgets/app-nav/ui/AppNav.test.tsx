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

let sent: ReturnType<typeof memoryProvider>;
let logged: ReturnType<typeof memoryLogs>;
beforeEach(() => {
  // `setModal` settles when the modal closes
  view.setModal.mockReset().mockResolvedValue(null);
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
          switcher={null}
          footer={null}
          railFooter={null}
        />
      </SidebarProvider>
    </TooltipProvider>
  );

const opened = () =>
  sent.events
    .filter((event) => event.name === "nav_item_opened")
    .map((event) => event.params);

it.each([
  ["Home", "home", "tutorials"],
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

it("reports a modal that fails to open", async () => {
  const failure = new Error("no modal host");
  view.setModal.mockRejectedValueOnce(failure);
  draw();
  fireEvent.click(screen.getByRole("button", { name: "Programs" }));
  await waitFor(() => expect(logged.entries).toHaveLength(1));
  expect(logged.entries[0].report).toBe(true);
  expect(logged.entries[0].error).toBe(failure);
});
