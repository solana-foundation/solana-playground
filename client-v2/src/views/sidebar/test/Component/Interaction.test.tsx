import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import Interaction from "./Interaction";

it("shows what the card holds beside its name", () => {
  render(
    <Interaction name="increment" meta="1 arg · 2 accounts">
      body
    </Interaction>
  );
  expect(
    screen.getByRole("button", { name: /increment/ }).textContent
  ).toContain("1 arg · 2 accounts");
});

it("starts folded when nobody holds it open", () => {
  render(<Interaction name="Counter">body</Interaction>);
  expect(screen.queryByText("body")).toBeNull();
});

it("follows a held open state and reports a toggle instead of folding itself", () => {
  const onOpenChange = vi.fn();
  render(
    <Interaction name="increment" open onOpenChange={onOpenChange}>
      body
    </Interaction>
  );
  expect(screen.getByText("body")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /increment/ }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(screen.getByText("body")).toBeTruthy();
});
