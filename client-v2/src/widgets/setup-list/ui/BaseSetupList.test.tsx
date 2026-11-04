import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import type { SetupStep, StepView, TodoStep } from "../model/steps";
import BaseSetupList from "./BaseSetupList";

const todo = (step: TodoStep): StepView => ({ step, done: false });
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

const renderList = (steps: StepView[], folded = false) => {
  const onPick = vi.fn();
  const onDismiss = vi.fn();
  const onFold = vi.fn();
  render(
    <BaseSetupList
      steps={steps}
      onPick={onPick}
      onDismiss={onDismiss}
      folded={folded}
      onFold={onFold}
    />
  );
  return { onPick, onDismiss, onFold };
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

it("asks to fold from its title", async () => {
  const { onFold } = renderList(TWO_DONE);
  await userEvent.click(screen.getByRole("button", { name: /^Get set up/ }));
  expect(onFold).toHaveBeenCalledExactlyOnceWith(true);
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

it("shows only its title while folded, and asks to unfold from it", async () => {
  const { onFold } = renderList(TWO_DONE, true);
  const title = screen.getByRole("button", { name: /^Get set up/ });
  expect(title.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("button", { name: "Connect a wallet" })).toBeNull();
  await userEvent.click(title);
  expect(onFold).toHaveBeenCalledExactlyOnceWith(false);
});

// Spec 08 NET-02 and the prototype's setup steps: a chosen network that does
// not answer loses its tick and warns, so the list never contradicts the
// notice over the stage
it("warns on a network that does not answer, with no tick and no button", () => {
  renderList([
    todo("assistant"),
    {
      step: "network",
      done: false,
      warn: "devnet is not responding",
      value: "devnet",
    },
    done("github", "octocat"),
    todo("wallet"),
  ]);
  const row = screen.getAllByRole("listitem")[1];
  expect(row.getAttribute("data-status")).toBe("warn");
  expect(row.getAttribute("title")).toBe("devnet is not responding");
  expect(row.textContent).toBe(
    "Choose a network, devnet is not respondingdevnet"
  );
  expect(screen.queryByRole("button", { name: /Choose a network/ })).toBeNull();
  // The warning network still counts: it is chosen, only not answering
  expect(screen.getByRole("button", { name: /^Get set up/ }).textContent).toBe(
    "Get set up· 2 of 4"
  );
});

it("shows a wallet that could not be read as a warning with Try again", async () => {
  const { onPick } = renderList([
    todo("assistant"),
    done("network", "devnet"),
    done("github", "octocat"),
    { step: "wallet", done: false, problem: "unavailable" },
  ]);
  const wallet = screen.getAllByRole("listitem")[3];
  expect(wallet.getAttribute("data-status")).toBe("warn");
  expect(screen.queryByRole("button", { name: "Connect a wallet" })).toBeNull();

  await userEvent.click(
    screen.getByRole("button", { name: "Wallet unavailable, try again" })
  );
  expect(onPick).toHaveBeenCalledExactlyOnceWith("wallet");
});
