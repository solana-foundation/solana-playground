import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Effort } from "../../../views/sidebar/assistant/model/types";
import { BaseEffortMenu } from "./BaseEffortMenu";

const ladder: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

const setup = (value: Effort, disabled = false) => {
  const onChange = vi.fn();
  render(
    <BaseEffortMenu
      effort={{ value, ladder }}
      onChange={onChange}
      disabled={disabled}
    />
  );
  return { onChange, user: userEvent.setup() };
};

describe("BaseEffortMenu", () => {
  it("names the level and its place on the ladder", () => {
    setup("medium");
    expect(screen.getByRole("button", { name: "Medium: 2 of 5" })).toBeTruthy();
  });

  it("writes xhigh as Extra high", () => {
    setup("xhigh");
    expect(
      screen.getByRole("button", { name: "Extra high: 4 of 5" })
    ).toBeTruthy();
  });

  it("lists the ladder with a check on the current level", async () => {
    const { user } = setup("medium");
    await user.click(screen.getByRole("button", { name: "Medium: 2 of 5" }));
    expect(screen.getAllByRole("menuitemradio").length).toBe(5);
    const checked = screen.getAllByRole("menuitemradio", { checked: true });
    expect(checked.length).toBe(1);
    expect(checked[0].textContent).toContain("Medium");
  });

  it("reports the picked level", async () => {
    const { user, onChange } = setup("medium");
    await user.click(screen.getByRole("button", { name: "Medium: 2 of 5" }));
    await user.click(screen.getByRole("menuitemradio", { name: "High" }));
    expect(onChange).toHaveBeenCalledWith("high");
  });

  it("renders nothing when the value is not on the ladder", () => {
    const { container } = render(
      <BaseEffortMenu
        effort={{ value: "max", ladder: ["low", "medium", "high"] }}
        onChange={vi.fn()}
        disabled={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("disables the trigger", () => {
    setup("medium", true);
    expect(
      screen
        .getByRole("button", { name: "Medium: 2 of 5" })
        .hasAttribute("disabled")
    ).toBe(true);
  });
});
