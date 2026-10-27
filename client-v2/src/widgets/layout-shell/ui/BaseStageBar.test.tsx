import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";
import BaseStageBar, { DOCS_URL } from "./BaseStageBar";
import type { BaseStageBarProps } from "./BaseStageBar";

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
      <BaseStageBar
        title={props.title}
        files={props.files}
        assistant={props.assistant}
      />
    </TooltipProvider>
  );

it("names the files toggle by what it does", async () => {
  const onToggle = vi.fn();
  const { rerender } = draw({
    title: null,
    files: { open: true, onToggle },
    assistant: { open: true, onToggle: vi.fn() },
  });
  const collapse = screen.getByRole("button", {
    name: "Collapse project panel",
  });
  expect(collapse.getAttribute("aria-expanded")).toBe("true");
  await userEvent.click(collapse);
  expect(onToggle).toHaveBeenCalledTimes(1);

  rerender(
    <TooltipProvider>
      <BaseStageBar
        title={null}
        files={{ open: false, onToggle }}
        assistant={{ open: true, onToggle: vi.fn() }}
      />
    </TooltipProvider>
  );
  expect(
    screen
      .getByRole("button", { name: "Expand project panel" })
      .getAttribute("aria-expanded")
  ).toBe("false");
});

it("names the assistant toggle by what it does", async () => {
  const onToggle = vi.fn();
  const { rerender } = draw({
    title: null,
    files: null,
    assistant: { open: true, onToggle },
  });
  const hide = screen.getByRole("button", { name: "Hide the assistant" });
  // The label says what a click does, so no pressed state on top ("Hide the
  // assistant, pressed"); whether the pane is open is `aria-expanded`, as on
  // the files toggle, which also draws the button filled
  expect(hide.hasAttribute("aria-pressed")).toBe(false);
  expect(hide.getAttribute("aria-expanded")).toBe("true");
  await userEvent.click(hide);
  expect(onToggle).toHaveBeenCalledTimes(1);

  rerender(
    <TooltipProvider>
      <BaseStageBar
        title={null}
        files={null}
        assistant={{ open: false, onToggle }}
      />
    </TooltipProvider>
  );
  expect(
    screen
      .getByRole("button", { name: "Expand assistant" })
      .getAttribute("aria-expanded")
  ).toBe("false");
});

it("draws no files toggle where it is not handed, and always the documentation", () => {
  draw({
    title: null,
    files: null,
    assistant: { open: true, onToggle: vi.fn() },
  });
  expect(screen.queryByRole("button", { name: /project panel/ })).toBeNull();
  const docs = screen.getByRole("link", { name: "Documentation" });
  expect(docs.getAttribute("href")).toBe(DOCS_URL);
  expect(docs.getAttribute("target")).toBe("_blank");
  expect(docs.getAttribute("rel")).toContain("noreferrer");
});

it("draws no assistant toggle where none is handed, as over a page", () => {
  draw({ title: "Tutorials", files: null, assistant: null });
  expect(screen.queryByRole("button", { name: /assistant/i })).toBeNull();
  expect(screen.getByText("Tutorials")).toBeTruthy();
});

it("shows the project's name only when given one", () => {
  const { rerender } = draw({
    title: "Counter",
    files: null,
    assistant: { open: true, onToggle: vi.fn() },
  });
  expect(screen.getByText("Counter")).toBeTruthy();
  rerender(
    <TooltipProvider>
      <BaseStageBar
        title={null}
        files={null}
        assistant={{ open: true, onToggle: vi.fn() }}
      />
    </TooltipProvider>
  );
  expect(screen.queryByText("Counter")).toBeNull();
});

it("is the 44 px column bar with a bottom line", () => {
  const { container } = draw({
    title: null,
    files: null,
    assistant: { open: true, onToggle: vi.fn() },
  });
  const bar = container.querySelector('[data-slot="stage-bar"]')!;
  expect(bar.className).toMatch(/\bh-11\b/);
  expect(bar.className).toMatch(/\bborder-b\b/);
});

it("names Ctrl+R in the assistant's hint, and no key when told none", async () => {
  const { unmount } = draw({
    title: null,
    files: null,
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
        files={null}
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

it("labels the files toggle 'Files' in text, as the prototype's head does", () => {
  draw({
    title: null,
    files: { open: true, onToggle: vi.fn() },
    assistant: { open: true, onToggle: vi.fn() },
  });
  const files = screen.getByRole("button", { name: "Collapse project panel" });
  expect(files.textContent).toBe("Files");
});

it("draws the title muted and the controls as 30 px squares", () => {
  const { container } = draw({
    title: "Counter",
    files: { open: true, onToggle: vi.fn() },
    assistant: { open: false, onToggle: vi.fn() },
  });
  expect(screen.getByText("Counter").className).toMatch(
    /\btext-muted-foreground\b/
  );
  for (const control of container.querySelectorAll(
    '[data-slot="stage-bar"] [data-slot="button"]'
  )) {
    expect(control.className).toMatch(/\bh-7\.5\b/);
    expect(control.className).toMatch(/\brounded-lg\b/);
  }
  expect(
    screen.getByRole("button", { name: "Expand assistant" }).className
  ).toMatch(/\bsize-7\.5\b/);
});

it("parts the documentation from the toggles with a rule", () => {
  const { container } = draw({
    title: null,
    files: null,
    assistant: { open: true, onToggle: vi.fn() },
  });
  expect(
    container.querySelector('[data-slot="stage-bar"] [data-slot="separator"]')
  ).not.toBeNull();
});
