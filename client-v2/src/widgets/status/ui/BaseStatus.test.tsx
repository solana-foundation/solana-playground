import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/shared/ui/sidebar";
import { TooltipProvider } from "@/shared/ui/tooltip";

import type { StatusIndicator } from "../model/indicators";
import {
  aiIndicator,
  analyzerIndicator,
  chipOf,
  networkIndicator,
} from "../model/indicators";
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
const AI_LIMIT = aiIndicator(
  { kind: "limit", until: new Date(2026, 10, 5, 5, 0).getTime() },
  true
);
const AI_DOWN = aiIndicator({ kind: "unreachable" }, true);
const STARTING = analyzerIndicator(
  { kind: "starting", since: 0 },
  12_000,
  true
);
const SLOW = analyzerIndicator({ kind: "starting", since: 0 }, 61_000, true);
const FAILED = analyzerIndicator({ kind: "failed" }, 0, true);
const NOT_STARTED = analyzerIndicator({ kind: "idle" }, 0, true);

const dotOf = (el: HTMLElement) =>
  el.querySelector('[data-slot="status-dot"]')?.getAttribute("data-variant");

const drawRow = (indicators: StatusIndicator[]) => {
  const onPick = vi.fn();
  const onAction = vi.fn();
  const onRetry = vi.fn(() => Promise.resolve());
  render(
    <TooltipProvider>
      <SidebarProvider>
        <BaseStatusRow
          indicators={indicators}
          onPick={onPick}
          onAction={onAction}
          onRetry={onRetry}
          settingsOpen={false}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
  return { onPick, onAction, onRetry };
};

it("draws the three indicators as buttons with a dot and words, the AI off grey", () => {
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
    "idle",
    "running",
  ]);
});

it("keeps red for a failure: an analyzer that failed", () => {
  drawRow([UP, AI_OFF, FAILED]);
  const rust = screen.getByRole("button", { name: "Rust analyzer, failed" });
  expect(dotOf(rust)).toBe("error");
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
it("says a cluster that is down is not responding, in words and a warning dot", () => {
  drawRow([DOWN, AI_OFF, STARTING]);
  const network = screen.getByRole("button", {
    name: "Change cluster, currently devnet, not responding",
  });
  expect(network.textContent).toBe("Devnet · Not responding");
  expect(dotOf(network)).toBe("warning");
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
          onRetry={vi.fn()}
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
          onRetry={vi.fn()}
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

it("labels each rail dot with its state in the row's words, on focus", async () => {
  render(
    <TooltipProvider>
      <SidebarProvider defaultOpen={false}>
        <BaseStatusRail
          indicators={[UP, AI_OFF, STARTING]}
          onPick={vi.fn()}
          onAction={vi.fn()}
          onRetry={vi.fn()}
          settingsOpen={false}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
  await userEvent.tab();
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "Devnet · Ready"
  );
  await userEvent.tab();
  expect((await screen.findByRole("tooltip")).textContent).toBe("AI · Off");
  await userEvent.tab();
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "Rust · Starting 12 s"
  );
});

it("opens the analyzer's panel from its rail dot, as the row does", async () => {
  const onPick = vi.fn();
  render(
    <TooltipProvider>
      <SidebarProvider defaultOpen={false}>
        <BaseStatusRail
          indicators={[UP, AI_OFF, SLOW]}
          onPick={onPick}
          onAction={vi.fn()}
          onRetry={vi.fn()}
          settingsOpen={false}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
  await userEvent.click(
    screen.getByRole("button", { name: /^Rust analyzer, taking longer/ })
  );
  const panel = await screen.findByRole("dialog");
  expect(within(panel).getByText("Taking longer")).toBeTruthy();
  expect(within(panel).getByRole("button", { name: "Reload" })).toBeTruthy();
  expect(onPick).toHaveBeenCalledExactlyOnceWith(SLOW);
});

it("reads Ready on the chip with only the AI off", () => {
  const indicators = [UP, AI_OFF, NOT_STARTED];
  render(
    <BaseStatusChip
      chip={chipOf(indicators, true)}
      indicators={indicators}
      open={false}
      onOpenChange={vi.fn()}
      onAction={vi.fn()}
      onRetry={vi.fn()}
    />
  );
  const chip = screen.getByRole("button", { name: "Status, ready" });
  expect([chip.textContent, dotOf(chip)]).toEqual(["Ready", "success"]);
});

it("folds the three into one chip whose sheet names what is down", async () => {
  const indicators = [DOWN, AI_OFF, STARTING];
  const onAction = vi.fn();
  const draw = (open: boolean) => (
    <BaseStatusChip
      chip={chipOf(indicators, true)}
      indicators={indicators}
      open={open}
      onOpenChange={vi.fn()}
      onAction={onAction}
      onRetry={vi.fn()}
    />
  );
  const { rerender } = render(draw(false));
  const chip = screen.getByRole("button", { name: "Status, 1 not ready" });
  expect([chip.textContent, dotOf(chip)]).toEqual(["1 not ready", "warning"]);

  rerender(draw(true));
  const sheet = await screen.findByRole("dialog", { name: "Status" });
  const ai = sheet.querySelector('[data-status="ai"]') as HTMLElement;
  expect(within(ai).getByText("Off")).toBeTruthy();
  await userEvent.click(
    within(ai).getByRole("button", { name: "Connect a model" })
  );
  expect(onAction).toHaveBeenCalledExactlyOnceWith(AI_OFF);
  expect(sheet.querySelectorAll("[data-status]")).toHaveLength(3);
});

it("opens the analyzer panel over the line on a phone, beside the navigation on a desk", async () => {
  const width = window.innerWidth;
  const panelFor = async (px: number) => {
    Object.defineProperty(window, "innerWidth", {
      value: px,
      configurable: true,
    });
    drawRow([UP, AI_OFF, STARTING]);
    await userEvent.click(
      screen.getByRole("button", { name: /^Rust analyzer, starting/ })
    );
    const panel = await screen.findByRole("dialog");
    const placed = [
      panel.getAttribute("data-side"),
      panel.getAttribute("data-align"),
    ];
    cleanup();
    return placed;
  };

  try {
    // Beside the line on a phone it opened about 296 px off the screen
    expect(await panelFor(390)).toEqual(["top", "start"]);
    expect(await panelFor(1280)).toEqual(["right", "end"]);
  } finally {
    Object.defineProperty(window, "innerWidth", {
      value: width,
      configurable: true,
    });
  }
});

it.each([
  { reading: "not responding", ai: AI_DOWN, retries: true },
  { reading: "at its limit", ai: AI_LIMIT, retries: false },
])(
  "gives the sheet's AI row its buttons while the AI is $reading",
  async ({ ai, retries }) => {
    const indicators = [UP, ai, STARTING];
    render(
      <BaseStatusChip
        chip={chipOf(indicators, true)}
        indicators={indicators}
        open
        onOpenChange={vi.fn()}
        onAction={vi.fn()}
        onRetry={vi.fn()}
      />
    );
    const sheet = await screen.findByRole("dialog", { name: "Status" });
    const row = sheet.querySelector('[data-status="ai"]') as HTMLElement;
    expect(
      within(row).getByRole("button", { name: "Add an API key" })
    ).toBeTruthy();
    expect(
      within(row).queryByRole("button", { name: "Try again" }) !== null
    ).toBe(retries);
  }
);

it("opens a panel on a cluster that does not answer, with Try again and Change network", async () => {
  const { onPick, onAction, onRetry } = drawRow([DOWN, AI_OFF, STARTING]);
  const network = screen.getByRole("button", {
    name: "Change cluster, currently devnet, not responding",
  });
  // The settings' focus return still finds it when Change network opens them
  expect(network.hasAttribute("data-settings-trigger")).toBe(true);
  await userEvent.click(network);
  const panel = await screen.findByRole("dialog");
  expect(within(panel).getByText("Network")).toBeTruthy();
  expect(within(panel).getByText(/The cluster is not responding/)).toBeTruthy();
  expect(onPick).toHaveBeenCalledExactlyOnceWith(DOWN);

  await userEvent.click(
    within(panel).getByRole("button", { name: "Try again" })
  );
  expect(onRetry).toHaveBeenCalledExactlyOnceWith(DOWN);
  await userEvent.click(
    within(panel).getByRole("button", { name: "Change network" })
  );
  expect(onAction).toHaveBeenCalledExactlyOnceWith(DOWN);
});

it("busies Try again while it asks", async () => {
  let answer: () => void = () => {};
  const onRetry = vi.fn(
    () => new Promise<void>((resolve) => (answer = resolve))
  );
  render(
    <TooltipProvider>
      <SidebarProvider>
        <BaseStatusRow
          indicators={[DOWN, AI_OFF, STARTING]}
          onPick={vi.fn()}
          onAction={vi.fn()}
          onRetry={onRetry}
          settingsOpen={false}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
  await userEvent.click(
    screen.getByRole("button", { name: /^Change cluster, currently devnet,/ })
  );
  const panel = await screen.findByRole("dialog");
  await userEvent.click(
    within(panel).getByRole("button", { name: "Try again" })
  );
  expect(await within(panel).findByText("Trying…")).toBeTruthy();
  answer();
  expect(
    await within(panel).findByRole("button", { name: "Try again" })
  ).toBeTruthy();
});

it.each([
  ["row", BaseStatusRow],
  ["rail", BaseStatusRail],
] as const)(
  "puts focus back on the indicator in the %s when Try again answers and its panel goes",
  async (_, Base) => {
    const draw = (indicators: StatusIndicator[]) => (
      <TooltipProvider>
        <SidebarProvider>
          <Base
            indicators={indicators}
            onPick={vi.fn()}
            onAction={vi.fn()}
            onRetry={() => Promise.resolve()}
            settingsOpen={false}
          />
        </SidebarProvider>
      </TooltipProvider>
    );
    const { rerender } = render(draw([DOWN, AI_OFF, STARTING]));
    const network = document.querySelector(
      '[data-status="network"]'
    ) as HTMLElement;
    network.focus();
    await userEvent.keyboard("{Enter}");
    const panel = await screen.findByRole("dialog");
    within(panel).getByRole("button", { name: "Try again" }).focus();
    await userEvent.keyboard("{Enter}");

    // The retry answered: the cluster is up, so the indicator has no panel
    rerender(draw([UP, AI_OFF, STARTING]));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(
      document.querySelector('[data-status="network"]')
    );
  }
);

it("leaves focus where the user put it while Try again was asking", async () => {
  let answer: () => void = () => {};
  const draw = (indicators: StatusIndicator[]) => (
    <TooltipProvider>
      <SidebarProvider>
        <BaseStatusRow
          indicators={indicators}
          onPick={vi.fn()}
          onAction={vi.fn()}
          onRetry={() => new Promise<void>((resolve) => (answer = resolve))}
          settingsOpen={false}
        />
      </SidebarProvider>
      <input aria-label="Elsewhere" />
    </TooltipProvider>
  );
  const { rerender } = render(draw([DOWN, AI_OFF, STARTING]));
  (document.querySelector('[data-status="network"]') as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  const panel = await screen.findByRole("dialog");
  within(panel).getByRole("button", { name: "Try again" }).focus();
  await userEvent.keyboard("{Enter}");
  const elsewhere = screen.getByRole("textbox", { name: "Elsewhere" });
  elsewhere.focus();

  answer();
  rerender(draw([UP, AI_OFF, STARTING]));

  expect(document.activeElement).toBe(elsewhere);
});

it("opens a panel on the AI's limit, whose Add an API key opens Connect a model", async () => {
  const { onPick, onAction } = drawRow([UP, AI_LIMIT, STARTING]);
  const ai = screen.getByRole("button", { name: "AI, limit reached" });
  expect([ai.textContent, dotOf(ai)]).toEqual([
    "AI · Limit reached",
    "warning",
  ]);
  await userEvent.click(ai);
  // Named by its title, so a reader of the page finds it as the AI's panel
  const panel = await screen.findByRole("dialog", { name: "AI" });
  expect(
    within(panel).getByText(
      "The free daily limit is used. It comes back at 05:00, or add a key of your own to keep going."
    )
  ).toBeTruthy();
  expect(within(panel).queryByRole("button", { name: "Try again" })).toBeNull();
  expect(onPick).toHaveBeenCalledExactlyOnceWith(AI_LIMIT);
  await userEvent.click(
    within(panel).getByRole("button", { name: "Add an API key" })
  );
  expect(onAction).toHaveBeenCalledExactlyOnceWith(AI_LIMIT);
});

it("reads a hosted model that does not answer red, with Try again", async () => {
  const { onRetry } = drawRow([UP, AI_DOWN, STARTING]);
  const ai = screen.getByRole("button", { name: "AI, not responding" });
  expect([ai.textContent, dotOf(ai)]).toEqual(["AI · Not responding", "error"]);
  await userEvent.click(ai);
  const panel = await screen.findByRole("dialog");
  await userEvent.click(
    within(panel).getByRole("button", { name: "Try again" })
  );
  expect(onRetry).toHaveBeenCalledExactlyOnceWith(AI_DOWN);
  expect(
    within(panel).getByRole("button", { name: "Add an API key" })
  ).toBeTruthy();
});

it("opens the down network's panel from its rail dot too", async () => {
  render(
    <TooltipProvider>
      <SidebarProvider defaultOpen={false}>
        <BaseStatusRail
          indicators={[DOWN, AI_OFF, STARTING]}
          onPick={vi.fn()}
          onAction={vi.fn()}
          onRetry={vi.fn()}
          settingsOpen={false}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
  const dot = screen.getByRole("button", {
    name: "Cluster: devnet, not responding",
  });
  expect(dot.hasAttribute("data-settings-trigger")).toBe(true);
  await userEvent.click(dot);
  const panel = await screen.findByRole("dialog");
  expect(within(panel).getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(
    within(panel).getByRole("button", { name: "Change network" })
  ).toBeTruthy();
});

it("puts Try again and Change network on the sheet's network row, and keeps the sheet open on Try again", async () => {
  const indicators = [DOWN, AI_OFF, STARTING];
  const onOpenChange = vi.fn();
  const onRetry = vi.fn(() => Promise.resolve());
  render(
    <BaseStatusChip
      chip={chipOf(indicators, true)}
      indicators={indicators}
      open
      onOpenChange={onOpenChange}
      onAction={vi.fn()}
      onRetry={onRetry}
    />
  );
  const sheet = await screen.findByRole("dialog", { name: "Status" });
  const network = sheet.querySelector('[data-status="network"]') as HTMLElement;
  expect(
    within(network).getByRole("button", { name: "Change network" })
  ).toBeTruthy();
  await userEvent.click(
    within(network).getByRole("button", { name: "Try again" })
  );
  expect(onRetry).toHaveBeenCalledExactlyOnceWith(DOWN);
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
});

it("keeps the focus on the sheet's row once its Try again is answered", async () => {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    onAction: vi.fn(),
    onRetry: vi.fn(() => Promise.resolve()),
  };
  const before = [DOWN, AI_OFF, STARTING];
  const { rerender } = render(
    <BaseStatusChip
      chip={chipOf(before, true)}
      indicators={before}
      {...props}
    />
  );
  const sheet = await screen.findByRole("dialog", { name: "Status" });
  const row = () =>
    sheet.querySelector('[data-status="network"]') as HTMLElement;
  await userEvent.click(
    within(row()).getByRole("button", { name: "Try again" })
  );

  const after = [UP, AI_OFF, STARTING];
  rerender(
    <BaseStatusChip chip={chipOf(after, true)} indicators={after} {...props} />
  );

  await vi.waitFor(() =>
    expect(row().contains(document.activeElement)).toBe(true)
  );
});

it("leaves the focus where the user moved it while the sheet's Try again ran", async () => {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    onAction: vi.fn(),
    onRetry: vi.fn(() => Promise.resolve()),
  };
  const before = [DOWN, AI_OFF, STARTING];
  const { rerender } = render(
    <BaseStatusChip
      chip={chipOf(before, true)}
      indicators={before}
      {...props}
    />
  );
  const sheet = await screen.findByRole("dialog", { name: "Status" });
  const row = sheet.querySelector('[data-status="network"]') as HTMLElement;
  await userEvent.click(within(row).getByRole("button", { name: "Try again" }));
  const elsewhere = within(row).getByRole("button", { name: "Change network" });
  elsewhere.focus();

  const after = [UP, AI_OFF, STARTING];
  rerender(
    <BaseStatusChip chip={chipOf(after, true)} indicators={after} {...props} />
  );

  expect(document.activeElement).toBe(elsewhere);
});

it("closes the panel when its action is picked", async () => {
  drawRow([DOWN, AI_OFF, STARTING]);
  await userEvent.click(
    screen.getByRole("button", { name: /^Change cluster, currently devnet,/ })
  );
  const panel = await screen.findByRole("dialog");
  await userEvent.click(
    within(panel).getByRole("button", { name: "Change network" })
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});
