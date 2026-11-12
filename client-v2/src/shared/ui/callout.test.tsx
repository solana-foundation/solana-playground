import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AsyncButton } from "./async-button";
import { CalloutAction } from "./callout";

/* jsdom cannot apply a stylesheet, so the look is read from the class list */
describe("CalloutAction", () => {
  afterEach(cleanup);

  const plain = () => {
    render(<CalloutAction>Plain</CalloutAction>);
    return screen.getByRole("button", { name: "Plain" });
  };
  const lent = () => {
    render(
      <CalloutAction asChild>
        <AsyncButton variant="ghost" size="sm">
          Lent
        </AsyncButton>
      </CalloutAction>
    );
    return screen.getByRole("button", { name: "Lent" });
  };

  it("is 44 px on a phone, plain or lent to a button", () => {
    expect(plain().className).toContain("max-md:h-11");
    expect(lent().className).toContain("max-md:h-11");
  });

  it("leaves nothing of Button's look on a lent action", () => {
    const { className } = lent();
    expect(className).not.toContain("hover:bg-muted");
    expect(className).not.toContain("hover:text-foreground");
    expect(className).not.toContain("translate-y-px");
    expect(className).not.toContain("bg-clip-padding");
    expect(className.split(" ")).not.toContain("border");
  });

  it("uses the same fill plain and lent", () => {
    const fill = (name: string) =>
      name.split(" ").filter((c) => c.includes("--action"));
    const plainFill = fill(plain().className);
    expect(plainFill.length).toBeGreaterThan(0);
    expect(fill(lent().className)).toEqual(plainFill);
  });

  it("is a plain button by default, so it never submits a form", () => {
    render(<CalloutAction>Stop</CalloutAction>);
    expect(screen.getByRole("button", { name: "Stop" })).toHaveProperty(
      "type",
      "button"
    );
  });

  describe("lending its look to an AsyncButton", () => {
    const renderLent = ({
      onClick,
      disabled,
    }: {
      onClick: () => unknown;
      disabled?: boolean;
    }) =>
      render(
        <CalloutAction asChild>
          <AsyncButton disabled={disabled} onClick={onClick}>
            Try now
          </AsyncButton>
        </CalloutAction>
      );
    const button = () =>
      screen.getByRole("button", { name: "Try now" }) as HTMLButtonElement;

    it("keeps the button's own disabled and click", () => {
      const onClick = vi.fn();
      const { unmount } = renderLent({ onClick, disabled: true });
      expect(button().disabled).toBe(true);
      unmount();

      renderLent({ onClick });
      fireEvent.click(button());
      expect(onClick).toHaveBeenCalledOnce();
    });

    it("stays busy while the click waits", async () => {
      let settle = () => {};
      renderLent({
        onClick: () => new Promise<void>((resolve) => (settle = resolve)),
      });
      fireEvent.click(button());
      // The spinner joins the button's name while it waits
      const busy = screen.getByRole("button");
      await waitFor(() => expect(busy.getAttribute("aria-busy")).toBe("true"));
      expect(busy.getAttribute("data-slot")).toBe("callout-action");

      settle();
      await waitFor(() => expect(busy.getAttribute("aria-busy")).toBeNull());
    });

    it("leaves none of the button's default fill or text colour", () => {
      renderLent({ onClick: () => undefined });
      expect(button().className).not.toMatch(/bg-primary|primary-foreground/);
    });
  });
});
