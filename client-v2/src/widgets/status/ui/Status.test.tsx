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
import { PgConnection } from "@/utils";

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

let current = INDICATORS;
afterEach(() => {
  current = INDICATORS;
});
// The real one loads the whole runtime; Try again only asks it to recheck
vi.mock("@/utils", () => ({ PgConnection: { recheck: vi.fn() } }));
vi.mock("../model/use-status", () => ({ useStatus: () => current }));

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
      onRetryAi={vi.fn()}
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
      onRetryAi={vi.fn()}
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
  render(
    <StatusChip
      onOpenNetwork={vi.fn()}
      onConnectAi={onConnectAi}
      onRetryAi={vi.fn()}
    />
  );
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

it("asks the cluster and the hosted model again on Try again, and measures what it found", async () => {
  current = [
    networkIndicator(
      // eslint-disable-next-line unicorn/no-null -- PgConnection's tri-state: null is "not known yet"
      { name: "devnet", isConnected: false, slotStalled: null },
      true
    ),
    aiIndicator({ kind: "unreachable" }, true),
    INDICATORS[2],
  ];
  const recheck = vi.mocked(PgConnection.recheck).mockResolvedValue(false);
  const onRetryAi = vi.fn(() => Promise.resolve(true));
  const onOpenNetwork = vi.fn();
  inNav(
    <StatusRow
      settingsOpen={false}
      onOpenNetwork={onOpenNetwork}
      onConnectAi={vi.fn()}
      onRetryAi={onRetryAi}
    />
  );

  // A panel opens instead of the settings
  await userEvent.click(
    screen.getByRole("button", { name: /^Change cluster, currently devnet,/ })
  );
  expect(onOpenNetwork).not.toHaveBeenCalled();
  await userEvent.click(
    await screen.findByRole("button", { name: "Try again" })
  );
  expect(recheck).toHaveBeenCalledOnce();
  await vi.waitFor(() =>
    expect(eventsNamed("status_retried")).toEqual([
      { indicator: "network", from: "row", answered: false },
    ])
  );
  await userEvent.keyboard("{Escape}");

  await userEvent.click(
    screen.getByRole("button", { name: "AI, not responding" })
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Try again" })
  );
  expect(onRetryAi).toHaveBeenCalledOnce();
  await vi.waitFor(() =>
    expect(eventsNamed("status_retried")).toEqual([
      { indicator: "network", from: "row", answered: false },
      { indicator: "ai", from: "row", answered: true },
    ])
  );
  recheck.mockReset();
});
