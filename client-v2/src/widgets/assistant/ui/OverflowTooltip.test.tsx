import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";
import { OverflowTooltip } from "./OverflowTooltip";

const LONG = "deepseek/deepseek-chat-v3.1-terminus-instruct:free";

/** jsdom lays nothing out, so the cut is stated: the text's width against its box's */
const setup = (cut: boolean) => {
  render(
    <TooltipProvider>
      <OverflowTooltip label={LONG}>
        <button type="button">
          <span data-overflow="">{LONG}</span>
        </button>
      </OverflowTooltip>
    </TooltipProvider>
  );
  const text = screen.getByText(LONG);
  Object.defineProperty(text, "scrollWidth", { value: cut ? 300 : 100 });
  Object.defineProperty(text, "clientWidth", { value: 100 });
  return userEvent.setup();
};

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("OverflowTooltip", () => {
  beforeEach(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterEach(() => vi.unstubAllGlobals());

  it("shows the whole label on focus when the text is cut", async () => {
    const user = setup(true);
    await user.tab();
    expect((await screen.findByRole("tooltip")).textContent).toBe(LONG);
  });

  it("shows the whole label on hover when the text is cut", async () => {
    const user = setup(true);
    await user.hover(screen.getByRole("button"));
    expect((await screen.findByRole("tooltip")).textContent).toBe(LONG);
  });

  it("shows nothing when the text fits", async () => {
    const user = setup(false);
    await user.tab();
    await user.hover(screen.getByRole("button"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
