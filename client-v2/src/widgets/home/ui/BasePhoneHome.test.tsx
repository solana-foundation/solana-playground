import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import BasePhoneHome from "./BasePhoneHome";
import type { BasePhoneHomeProps } from "./BasePhoneHome";

const props = (): BasePhoneHomeProps => ({
  quickstarts: [
    {
      id: "continue",
      workspace: "counter",
      title: "Continue counter",
      description: "Your last project",
    },
    {
      id: "new",
      framework: "Anchor",
      title: "New Anchor project",
      description: "A working starter",
    },
    {
      id: "tutorial",
      name: "Hello Anchor",
      title: "Hello Anchor",
      description: "Beginner tutorial",
    },
  ],
  tutorialCount: 16,
  programCount: 34,
  onQuickstart: vi.fn().mockResolvedValue(undefined),
  onBrowse: vi.fn(),
  onAsk: vi.fn(),
});
const draw = (p: BasePhoneHomeProps) => {
  render(<BasePhoneHome {...p} />);
  return within(screen.getByRole("region", { name: "Home" }));
};

it("asks the question, counts the library and offers the assistant", () => {
  const home = draw(props());
  expect(
    home.getByRole("heading", { level: 1, name: "Where should we begin?" })
  ).toBeTruthy();
  expect(home.getByText("16 tutorials, 34 programs")).toBeTruthy();
  expect(home.getByRole("button", { name: "Browse" })).toBeTruthy();
  expect(home.getByRole("button", { name: "Ask the assistant" })).toBeTruthy();
});

it("shows the quick starts in order, each with its title and description", () => {
  const home = draw(props());
  const nav = within(home.getByRole("navigation", { name: "Quick start" }));
  const buttons = nav.getAllByRole("button");
  expect(buttons.map((b) => b.textContent)).toEqual([
    "Continue counterYour last project",
    "New Anchor projectA working starter",
    "Hello AnchorBeginner tutorial",
  ]);
});

it("keeps an ellipsis while the program count loads", () => {
  const p = props();
  p.programCount = null;
  const home = draw(p);
  expect(home.getByText("16 tutorials, … programs")).toBeTruthy();
});

it("reports a pressed quick start by its id", async () => {
  const p = props();
  const home = draw(p);
  // Async: a quick start is an AsyncButton, which settles once its promise does
  await act(async () => {
    fireEvent.click(home.getByRole("button", { name: /New Anchor project/ }));
  });
  expect(p.onQuickstart).toHaveBeenCalledWith(p.quickstarts[1]);
});

it("disables a quick start while its promise runs", async () => {
  const p = props();
  let settle: () => void = () => {};
  p.onQuickstart = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      })
  );
  const home = draw(p);
  const button = home.getByRole("button", { name: /Hello Anchor/ });
  fireEvent.click(button);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(p.onQuickstart).toHaveBeenCalledTimes(1);
  await act(async () => settle());
  await vi.waitFor(() =>
    expect((button as HTMLButtonElement).disabled).toBe(false)
  );
});

it("opens Browse and the assistant", () => {
  const p = props();
  const home = draw(p);
  fireEvent.click(home.getByRole("button", { name: "Browse" }));
  expect(p.onBrowse).toHaveBeenCalledTimes(1);
  fireEvent.click(home.getByRole("button", { name: "Ask the assistant" }));
  expect(p.onAsk).toHaveBeenCalledTimes(1);
});
