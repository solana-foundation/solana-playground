import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { SidebarProvider } from "@/shared/ui/sidebar";
import { TooltipProvider } from "@/shared/ui/tooltip";
import {
  aiIndicator,
  analyzerIndicator,
  networkIndicator,
} from "../model/indicators";
import { StatusChip, StatusRail, StatusRow } from "./Status";

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// The rail's tooltips measure themselves, and jsdom has no `ResizeObserver`
beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
afterAll(() => vi.unstubAllGlobals());

const INDICATORS = [
  networkIndicator(
    { name: "devnet", isConnected: true, slotStalled: false },
    true
  ),
  aiIndicator({ kind: "off", needsSignIn: false }, true),
  analyzerIndicator({ kind: "starting", since: 0 }, 1_000, true),
];

vi.mock("../model/use-status", () => ({ useStatus: () => INDICATORS }));

let sent: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});
afterEach(() => resetTelemetry());

const eventsNamed = (name: string) =>
  sent.events.filter((event) => event.name === name).map((e) => e.params);

const inNav = (node: React.ReactNode) =>
  render(
    <TooltipProvider>
      <SidebarProvider>{node}</SidebarProvider>
    </TooltipProvider>
  );

it("measures a pick in the row and runs the network's and the AI's action", async () => {
  const onOpenNetwork = vi.fn();
  const onConnectAi = vi.fn();
  inNav(
    <StatusRow
      settingsOpen={false}
      onOpenNetwork={onOpenNetwork}
      onConnectAi={onConnectAi}
    />
  );
  await userEvent.click(screen.getByRole("button", { name: "AI, off" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Change cluster, currently devnet" })
  );
  await userEvent.click(screen.getByRole("button", { name: /^Rust analyzer/ }));
  expect(onConnectAi).toHaveBeenCalledOnce();
  expect(onOpenNetwork).toHaveBeenCalledOnce();
  expect(eventsNamed("status_indicator_picked")).toEqual([
    // No model is grey (`idle`), which is measured as ready
    { indicator: "ai", state: "ready", from: "row" },
    { indicator: "network", state: "ready", from: "row" },
    { indicator: "rust", state: "working", from: "row" },
  ]);
});

it("measures a pick on the rail", async () => {
  inNav(
    <StatusRail
      settingsOpen={false}
      onOpenNetwork={vi.fn()}
      onConnectAi={vi.fn()}
    />
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Cluster: devnet" })
  );
  expect(eventsNamed("status_indicator_picked")).toEqual([
    { indicator: "network", state: "ready", from: "rail" },
  ]);
});

it("measures the sheet opening and a row's action", async () => {
  const onConnectAi = vi.fn();
  render(<StatusChip onOpenNetwork={vi.fn()} onConnectAi={onConnectAi} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Status, starting" })
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Connect a model" })
  );
  expect(onConnectAi).toHaveBeenCalledOnce();
  expect(eventsNamed("status_sheet_opened")).toEqual([{ worst: "working" }]);
  expect(eventsNamed("status_indicator_picked")).toEqual([
    { indicator: "ai", state: "ready", from: "sheet" },
  ]);
});
