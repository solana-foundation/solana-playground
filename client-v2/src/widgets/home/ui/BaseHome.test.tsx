import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import BaseHome from "./BaseHome";
import type { BaseHomeProps, HomeTutorial } from "./BaseHome";

const tutorial = (name: string): HomeTutorial => ({
  name,
  description: `${name} description`,
  level: "Beginner",
  framework: "Anchor",
  thumbnail: "/t.png",
});
const props = (): BaseHomeProps => ({
  tutorials: ["Hello Anchor", "B", "C", "D", "E", "F"].map(tutorial),
  programCount: 34,
  scratch: <div data-testid="scratch" />,
  onTile: vi.fn(),
  onNewProject: vi.fn(),
  onTutorial: vi.fn().mockResolvedValue(undefined),
  tutorialError: null,
  onAllTutorials: vi.fn(),
  onAsk: vi.fn(),
});
const draw = (p: BaseHomeProps) => {
  render(<BaseHome {...p} />);
  return within(screen.getByRole("region", { name: "Home" }));
};

it("asks the question and offers the assistant", () => {
  const home = draw(props());
  expect(
    home.getByRole("heading", { level: 1, name: "Where should we begin?" })
  ).toBeTruthy();
  expect(home.getByRole("button", { name: "Ask the assistant" })).toBeTruthy();
});

it("shows the three tiles with their counts", () => {
  const home = draw(props());
  expect(home.getByRole("button", { name: "New project" })).toBeTruthy();
  expect(home.getByRole("button", { name: "Follow a tutorial" })).toBeTruthy();
  expect(home.getByRole("button", { name: "Open a program" })).toBeTruthy();
  expect(home.getByText("6 guided paths")).toBeTruthy();
  expect(home.getByText("34 real programs")).toBeTruthy();
});

it("shows an ellipsis while the program count loads", () => {
  const p = props();
  p.programCount = null;
  const home = draw(p);
  expect(home.getByText("… real programs")).toBeTruthy();
});

it("shows four of the tutorials and links to all of them", () => {
  const p = props();
  const home = draw(p);
  expect(home.getAllByRole("button", { name: /^Open [A-Z]/ }).length).toBe(4);
  expect(home.queryByRole("button", { name: "Open E" })).toBeNull();
  fireEvent.click(home.getByRole("button", { name: "All 6" }));
  expect(p.onAllTutorials).toHaveBeenCalledTimes(1);
});

it("writes a tutorial's level and framework as one plain line", () => {
  const home = draw(props());
  const card = home
    .getByRole("button", { name: "Hello Anchor" })
    .closest<HTMLElement>("[data-slot=action-card]");
  const eyebrow = card?.querySelector("[data-slot=action-card-eyebrow]");
  expect(eyebrow?.textContent).toBe("Beginner · Anchor");
  expect(eyebrow?.querySelector("[data-slot=tag]")).toBeNull();
});

it("writes the level alone for a tutorial with no framework", () => {
  const p = props();
  p.tutorials = [
    {
      name: "Bare",
      description: "Bare description",
      level: "Beginner",
      framework: undefined,
      thumbnail: "/t.png",
    },
  ];
  const home = draw(p);
  const eyebrow = home
    .getByRole("button", { name: "Bare" })
    .closest<HTMLElement>("[data-slot=action-card]")
    ?.querySelector("[data-slot=action-card-eyebrow]");
  expect(eyebrow?.textContent).toBe("Beginner");
});

it("draws the tiles' icons bare, with no tile behind them", () => {
  const home = draw(props());
  for (const name of ["New project", "Follow a tutorial", "Open a program"]) {
    const media = home
      .getByRole("button", { name })
      .closest<HTMLElement>("[data-slot=action-card]")
      ?.querySelector("[data-slot=action-card-media]");
    expect(media?.getAttribute("data-variant")).toBe("glyph");
  }
});

it("unfolds and folds the scratch options under New project", () => {
  const p = props();
  const home = draw(p);
  const tile = home.getByRole("button", { name: "New project" });
  expect(tile.getAttribute("aria-expanded")).toBe("false");
  expect(home.queryByTestId("scratch")).toBeNull();
  fireEvent.click(tile);
  expect(home.getByTestId("scratch")).toBeTruthy();
  expect(tile.getAttribute("aria-expanded")).toBe("true");
  expect(p.onNewProject).toHaveBeenCalledTimes(1);
  fireEvent.click(tile);
  expect(home.queryByTestId("scratch")).toBeNull();
  expect(p.onNewProject).toHaveBeenCalledTimes(1);
});

it("reports the other tiles", () => {
  const p = props();
  const home = draw(p);
  fireEvent.click(home.getByRole("button", { name: "Open a program" }));
  expect(p.onTile).toHaveBeenCalledWith("programs");
  fireEvent.click(home.getByRole("button", { name: "Follow a tutorial" }));
  expect(p.onTile).toHaveBeenCalledWith("tutorials");
});

it("opens a tutorial by name", async () => {
  const p = props();
  const home = draw(p);
  // Async: Open is an AsyncButton, which settles once `onTutorial` resolves
  await act(async () => {
    fireEvent.click(home.getByRole("button", { name: "Open Hello Anchor" }));
  });
  expect(p.onTutorial).toHaveBeenCalledWith("Hello Anchor");
});

it("opens a tutorial from its card, where the Open button is hidden below md", () => {
  const p = props();
  const home = draw(p);
  fireEvent.click(home.getByRole("button", { name: "Hello Anchor" }));
  expect(p.onTutorial).toHaveBeenCalledWith("Hello Anchor");
});

it("opens the assistant from the composer", () => {
  const p = props();
  const home = draw(p);
  fireEvent.click(home.getByRole("button", { name: "Ask the assistant" }));
  expect(p.onAsk).toHaveBeenCalledTimes(1);
});

it("lays out the prototype's 736 px column, 20 px apart, with its send", () => {
  draw(props());
  const home = screen.getByRole("region", { name: "Home" });
  // min(50rem, 100%) less 2rem a side
  expect(home.className).toMatch(/\bmax-w-\[50rem\]/);
  expect(home.className).toMatch(/\bpx-8\b/);
  expect(home.className).toMatch(/\bgap-5\b/);
  expect(home.querySelector('[data-slot="logo-play"]')).not.toBeNull();
});

it("lets its send open the assistant too", () => {
  const p = props();
  const home = draw(p);
  fireEvent.click(home.getByRole("button", { name: "Send" }));
  expect(p.onAsk).toHaveBeenCalledTimes(1);
});
