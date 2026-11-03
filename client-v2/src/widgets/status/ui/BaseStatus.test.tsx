import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/shared/ui/sidebar";
import { TooltipProvider } from "@/shared/ui/tooltip";
import {
  aiIndicator,
  analyzerIndicator,
  chipOf,
  networkIndicator,
} from "../model/indicators";
import type { StatusIndicator } from "../model/indicators";
import BaseStatusChip from "./BaseStatusChip";
import BaseStatusRail from "./BaseStatusRail";
import BaseStatusRow from "./BaseStatusRow";

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// The rail's tooltips measure themselves, and jsdom has no `ResizeObserver`
beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
afterAll(() => vi.unstubAllGlobals());

const UP = networkIndicator(
  { name: "devnet", isConnected: true, slotStalled: false },
  true
);
const DOWN = networkIndicator(
  { name: "devnet", isConnected: false, slotStalled: null },
  true
);
const AI_OFF = aiIndicator({ kind: "off", needsSignIn: false }, true);
const STARTING = analyzerIndicator(
  { kind: "starting", since: 0 },
  12_000,
  true
);
const SLOW = analyzerIndicator({ kind: "starting", since: 0 }, 61_000, true);

const dotOf = (el: HTMLElement) =>
  el.querySelector('[data-slot="status-dot"]')?.getAttribute("data-variant");

const drawRow = (indicators: StatusIndicator[]) => {
  const onPick = vi.fn();
  const onAction = vi.fn();
  render(
    <TooltipProvider>
      <SidebarProvider>
        <BaseStatusRow
          indicators={indicators}
          onPick={onPick}
          onAction={onAction}
          settingsOpen={false}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
  return { onPick, onAction };
};

it("draws the three indicators as buttons with a dot and words", () => {
  drawRow([UP, AI_OFF, STARTING]);
  const network = screen.getByRole("button", {
    name: "Change cluster, currently devnet",
  });
  const ai = screen.getByRole("button", { name: "AI, off" });
  const rust = screen.getByRole("button", {
    name: "Rust analyzer, starting, 12 seconds",
  });
  expect([network.textContent, ai.textContent, rust.textContent]).toEqual([
    "Devnet",
    "AI · Off",
    "Rust · Starting 12 s",
  ]);
  expect([dotOf(network), dotOf(ai), dotOf(rust)]).toEqual([
    "success",
    "error",
    "running",
  ]);
});

it("marks the network indicator as a settings trigger that opens the settings", async () => {
  const { onPick } = drawRow([UP, AI_OFF, STARTING]);
  const network = screen.getByRole("button", {
    name: "Change cluster, currently devnet",
  });
  expect(network.hasAttribute("data-settings-trigger")).toBe(true);
  await userEvent.click(network);
  expect(onPick).toHaveBeenCalledExactlyOnceWith(UP);
});

// Spec 08's NET-02, which replaced the "Switch to localnet?" toast
it("says a cluster that is down is not answering, in words and a red dot", () => {
  drawRow([DOWN, AI_OFF, STARTING]);
  const network = screen.getByRole("button", {
    name: "Change cluster, currently devnet, not answering",
  });
  expect(network.textContent).toBe("Devnet · Not answering");
  expect(dotOf(network)).toBe("error");
});

it("goes straight to Connect a model from the AI", async () => {
  const { onPick } = drawRow([UP, AI_OFF, STARTING]);
  await userEvent.click(screen.getByRole("button", { name: "AI, off" }));
  expect(onPick).toHaveBeenCalledExactlyOnceWith(AI_OFF);
});

it("opens the analyzer's panel, whose Reload is its action once slow", async () => {
  const { onPick, onAction } = drawRow([UP, AI_OFF, SLOW]);
  await userEvent.click(
    screen.getByRole("button", { name: /^Rust analyzer, taking longer/ })
  );
  const panel = await screen.findByRole("dialog");
  expect(within(panel).getByText("Rust analyzer")).toBeTruthy();
  expect(
    within(panel).getByText(/hints and errors in the editor/i)
  ).toBeTruthy();
  expect(onPick).toHaveBeenCalledExactlyOnceWith(SLOW);
  await userEvent.click(within(panel).getByRole("button", { name: "Reload" }));
  expect(onAction).toHaveBeenCalledExactlyOnceWith(SLOW);
});

it("offers nothing to press in a start's first minute", async () => {
  drawRow([UP, AI_OFF, STARTING]);
  await userEvent.click(
    screen.getByRole("button", { name: /^Rust analyzer, starting/ })
  );
  const panel = await screen.findByRole("dialog");
  expect(within(panel).queryByRole("button")).toBeNull();
});

it("says the open settings on the network indicator", () => {
  render(
    <TooltipProvider>
      <SidebarProvider>
        <BaseStatusRow
          indicators={[UP, AI_OFF, STARTING]}
          onPick={vi.fn()}
          onAction={vi.fn()}
          settingsOpen
        />
      </SidebarProvider>
    </TooltipProvider>
  );
  expect(
    screen
      .getByRole("button", { name: "Change cluster, currently devnet" })
      .getAttribute("aria-expanded")
  ).toBe("true");
});

it("draws three dots on the rail, named as their indicators", async () => {
  const onPick = vi.fn();
  render(
    <TooltipProvider>
      <SidebarProvider defaultOpen={false}>
        <BaseStatusRail
          indicators={[UP, AI_OFF, STARTING]}
          onPick={onPick}
          onAction={vi.fn()}
          settingsOpen={false}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
  const dot = screen.getByRole("button", { name: "Cluster: devnet" });
  expect(dot.hasAttribute("data-settings-trigger")).toBe(true);
  expect(screen.getByRole("button", { name: "AI, off" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: /^Rust analyzer, starting/ })
  ).toBeTruthy();
  await userEvent.click(dot);
  expect(onPick).toHaveBeenCalledExactlyOnceWith(UP);
});

it("folds the three into one chip whose sheet names what is down", async () => {
  const indicators = [UP, AI_OFF, STARTING];
  const onAction = vi.fn();
  const draw = (open: boolean) => (
    <BaseStatusChip
      chip={chipOf(indicators, true)}
      indicators={indicators}
      open={open}
      onOpenChange={vi.fn()}
      onAction={onAction}
    />
  );
  const { rerender } = render(draw(false));
  const chip = screen.getByRole("button", { name: "Status, 1 not ready" });
  expect(chip.textContent).toBe("1 not ready");

  rerender(draw(true));
  const sheet = await screen.findByRole("dialog", { name: "Status" });
  const ai = sheet.querySelector('[data-status="ai"]') as HTMLElement;
  expect(within(ai).getByText("AI · Off")).toBeTruthy();
  await userEvent.click(
    within(ai).getByRole("button", { name: "Connect a model" })
  );
  expect(onAction).toHaveBeenCalledExactlyOnceWith(AI_OFF);
  expect(sheet.querySelectorAll("[data-status]")).toHaveLength(3);
});
