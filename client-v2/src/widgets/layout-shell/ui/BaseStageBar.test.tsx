import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";
import { requireFor } from "@/test-utils/require-for";

import type { BaseStageBarProps } from "./BaseStageBar";
import BaseStageBar, { DOCS_URL } from "./BaseStageBar";

// A click hovers first, which opens the button's tooltip; Radix measures it
// with a ResizeObserver, which jsdom lacks
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
afterEach(() => vi.unstubAllGlobals());

const draw = (props: BaseStageBarProps) =>
  render(
    <TooltipProvider>
      <BaseStageBar title={props.title} assistant={props.assistant} />
    </TooltipProvider>
  );

it("names the assistant toggle by what it does", async () => {
  const onToggle = vi.fn();
  const { rerender } = draw({
    title: null,
    assistant: { open: true, onToggle },
  });
  const hide = screen.getByRole("button", { name: "Hide the assistant" });
  // The label says what a click does, so no pressed state on top ("Hide the
  // assistant, pressed"); whether the pane is open is `aria-expanded`, which
  // also draws the button filled
  expect(hide.hasAttribute("aria-pressed")).toBe(false);
  expect(hide.getAttribute("aria-expanded")).toBe("true");
  await userEvent.click(hide);
  expect(onToggle).toHaveBeenCalledTimes(1);

  rerender(
    <TooltipProvider>
      <BaseStageBar title={null} assistant={{ open: false, onToggle }} />
    </TooltipProvider>
  );
  expect(
    screen
      .getByRole("button", { name: "Expand assistant" })
      .getAttribute("aria-expanded")
  ).toBe("false");
});

it("draws no files toggle, which is the editor head's, and always the documentation behind More", async () => {
  draw({
    title: null,
    assistant: { open: true, onToggle: vi.fn() },
  });
  expect(screen.queryByRole("button", { name: /files/i })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "More options" }));
  const docs = screen.getByRole("menuitem", { name: "Documentation" });
  expect(docs.getAttribute("href")).toBe(DOCS_URL);
  expect(docs.getAttribute("target")).toBe("_blank");
  expect(docs.getAttribute("rel")).toContain("noreferrer");
});

it("draws no assistant toggle where none is handed, as over a page", () => {
  draw({ title: "Tutorials", assistant: null });
  expect(screen.queryByRole("button", { name: /assistant/i })).toBeNull();
  expect(screen.getByText("Tutorials")).toBeTruthy();
});

it("shows the project's name only when given one", () => {
  const { rerender } = draw({
    title: "Counter",
    assistant: { open: true, onToggle: vi.fn() },
  });
  expect(screen.getByText("Counter")).toBeTruthy();
  rerender(
    <TooltipProvider>
      <BaseStageBar
        title={null}
        assistant={{ open: true, onToggle: vi.fn() }}
      />
    </TooltipProvider>
  );
  expect(screen.queryByText("Counter")).toBeNull();
});

it("is the 44 px column bar with a bottom line", () => {
  const { container } = draw({
    title: null,
    assistant: { open: true, onToggle: vi.fn() },
  });
  const bar = requireFor("the stage bar")(
    container.querySelector('[data-slot="stage-bar"]')
  );
  expect(bar.className).toMatch(/\bh-11\b/);
  expect(bar.className).toMatch(/\bborder-b\b/);
});

it("names Ctrl+R in the assistant's hint, and no key when told none", async () => {
  const { unmount } = draw({
    title: null,
    assistant: { open: false, onToggle: vi.fn() },
  });
  await userEvent.tab();
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "Expand assistant (Ctrl+R)"
  );
  unmount();

  render(
    <TooltipProvider>
      <BaseStageBar
        title="Home"
        assistant={{ open: false, onToggle: vi.fn() }}
        assistantKey={null}
      />
    </TooltipProvider>
  );
  await userEvent.tab();
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "Expand assistant"
  );
});

it("draws the title muted and the controls as 32 px squares", () => {
  const { container } = draw({
    title: "Counter",
    assistant: { open: false, onToggle: vi.fn() },
  });
  expect(screen.getByText("Counter").className).toMatch(
    /\btext-muted-foreground\b/
  );
  for (const control of container.querySelectorAll(
    '[data-slot="stage-bar"] [data-slot="button"]'
  )) {
    expect(control.className).toMatch(/\bh-8\b/);
    expect(control.className).toMatch(/\brounded-lg\b/);
  }
  expect(
    screen.getByRole("button", { name: "Expand assistant" }).className
  ).toMatch(/\bsize-8\b/);
});

it("puts More last, after the toggles", () => {
  draw({
    title: null,
    assistant: { open: true, onToggle: vi.fn() },
  });
  const names = screen
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label"));
  expect(names.at(-1)).toBe("More options");
});

it("draws the page's actions before the toggles", () => {
  render(
    <TooltipProvider>
      <BaseStageBar
        title="counter"
        // eslint-disable-next-line unicorn/no-null -- `BaseStageBarProps.assistant` takes `null` for "no toggle"
        assistant={null}
        actions={<button type="button">Share counter</button>}
      />
    </TooltipProvider>
  );
  const names = screen
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? button.textContent);
  expect(names[0]).toBe("Share counter");
});
