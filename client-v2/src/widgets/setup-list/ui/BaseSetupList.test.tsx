import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import type { SetupStep, StepView } from "../model/steps";
import BaseSetupList from "./BaseSetupList";

const todo = (step: SetupStep): StepView => ({ step, done: false });
const done = (step: SetupStep, value: string): StepView => ({
  step,
  done: true,
  value,
});

const TWO_DONE: StepView[] = [
  todo("assistant"),
  done("network", "devnet"),
  done("github", "octocat"),
  todo("wallet"),
];

const renderList = (steps: StepView[]) => {
  const onPick = vi.fn();
  const onDismiss = vi.fn();
  render(<BaseSetupList steps={steps} onPick={onPick} onDismiss={onDismiss} />);
  return { onPick, onDismiss };
};

it("counts the done steps in its title", () => {
  renderList(TWO_DONE);
  expect(screen.getByRole("button", { name: /^Get set up/ }).textContent).toBe(
    "Get set up· 2 of 4"
  );
});

it("shows a done step's value with no button, and a step to do as a button", () => {
  renderList(TWO_DONE);
  expect(screen.getByText("devnet")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Choose a network/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Connect a wallet" })).toBeTruthy();
});

it("runs a step's action when it is clicked", async () => {
  const { onPick } = renderList(TWO_DONE);
  await userEvent.click(
    screen.getByRole("button", { name: "Connect the assistant" })
  );
  expect(onPick).toHaveBeenCalledWith("assistant");
});

it("dismisses itself from the dismiss button", async () => {
  const { onDismiss } = renderList(TWO_DONE);
  await userEvent.click(
    screen.getByRole("button", { name: "Dismiss the checklist" })
  );
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it("folds and unfolds from its title", async () => {
  renderList(TWO_DONE);
  const title = screen.getByRole("button", { name: /^Get set up/ });
  await userEvent.click(title);
  expect(screen.queryByRole("button", { name: "Connect a wallet" })).toBeNull();
  await userEvent.click(title);
  expect(screen.getByRole("button", { name: "Connect a wallet" })).toBeTruthy();
});

it("puts a step's extra attributes on its button", () => {
  const onPick = vi.fn();
  render(
    <BaseSetupList
      steps={TWO_DONE}
      onPick={onPick}
      onDismiss={vi.fn()}
      stepAttrs={{ wallet: { "data-marker": "" } }}
    />
  );
  expect(
    screen
      .getByRole("button", { name: "Connect a wallet" })
      .hasAttribute("data-marker")
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: "Connect the assistant" })
      .hasAttribute("data-marker")
  ).toBe(false);
});

it("says a step is done in words, not only with the tick", () => {
  renderList(TWO_DONE);
  const items = screen.getAllByRole("listitem");
  expect(items.map((item) => item.textContent)).toEqual([
    "Connect the assistant",
    "Choose a network, donedevnet",
    "Sign in with GitHub, doneoctocat",
    "Connect a wallet",
  ]);
});

it("starts folded to its one line when told to, as on a phone's menu", async () => {
  render(
    <BaseSetupList
      steps={TWO_DONE}
      onPick={vi.fn()}
      onDismiss={vi.fn()}
      folded
    />
  );
  const title = screen.getByRole("button", { name: /^Get set up/ });
  expect(title.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("button", { name: "Connect a wallet" })).toBeNull();
  await userEvent.click(title);
  expect(screen.getByRole("button", { name: "Connect a wallet" })).toBeTruthy();
});
