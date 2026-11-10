import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { TutorialProgress } from "@/entities/tutorial";

import type { BaseHomeProps, HomeTutorial } from "./BaseHome";
import BaseHome from "./BaseHome";

// The entity's entry reaches the store; these tests need only its cover
vi.mock("@/entities/tutorial", async () => ({
  TutorialCover: (await import("@/entities/tutorial/ui/art/TutorialCover"))
    .default,
}));

const tutorial = (name: string): HomeTutorial => ({
  name,
  description: `${name} description`,
  level: "Beginner",
  framework: "Anchor",
});
const props = (start: BaseHomeProps["start"]): BaseHomeProps => ({
  tutorials: ["Hello Anchor", "B", "C", "D", "E", "F"].map(tutorial),
  programCount: 34,
  onTile: vi.fn(),
  onTutorial: vi.fn().mockResolvedValue(undefined),
  tutorialError: undefined,
  onAllTutorials: vi.fn(),
  onAsk: vi.fn(),
  start,
});
const draw = (p: BaseHomeProps) => {
  render(<BaseHome {...p} />);
  return within(screen.getByRole("region", { name: "Home" }));
};

it("asks the question and offers the assistant", () => {
  const home = draw(props(undefined));
  expect(
    home.getByRole("heading", { level: 1, name: "Where should we begin?" })
  ).toBeTruthy();
  expect(home.getByRole("button", { name: "Ask the assistant" })).toBeTruthy();
});

it("shows the three tiles with their counts", () => {
  const home = draw(props(undefined));
  expect(home.getByRole("button", { name: "New project" })).toBeTruthy();
  expect(home.getByRole("button", { name: "Follow a tutorial" })).toBeTruthy();
  expect(home.getByRole("button", { name: "Open a program" })).toBeTruthy();
  expect(home.getByText("6 guided paths")).toBeTruthy();
  expect(home.getByText("34 real programs")).toBeTruthy();
});

it("shows an ellipsis while the program count loads", () => {
  const p = props(undefined);
  p.programCount = null;
  const home = draw(p);
  expect(home.getByText("… real programs")).toBeTruthy();
});

it("shows four of the tutorials and links to all of them", () => {
  const p = props(undefined);
  const home = draw(p);
  expect(home.getAllByRole("button", { name: /^Open [A-Z]/ }).length).toBe(4);
  expect(home.queryByRole("button", { name: "Open E" })).toBeNull();
  fireEvent.click(home.getByRole("button", { name: "All 6" }));
  expect(p.onAllTutorials).toHaveBeenCalledTimes(1);
});

it("draws a tutorial's brand cover with the lesson's icon", () => {
  const home = draw(props(undefined));
  const media = home
    .getByRole("button", { name: "Hello Anchor" })
    .closest<HTMLElement>("[data-slot=action-card]")
    ?.querySelector<HTMLElement>("[data-slot=action-card-media]");
  expect(media?.querySelector("img")).toBeNull();
  const cover = media?.firstElementChild as HTMLElement | null;
  expect(cover?.getAttribute("aria-hidden")).toBe("true");
  expect(cover?.querySelector("svg")?.classList).toContain("lucide-anchor");
});

it("writes a tutorial's level and framework as one plain line", () => {
  const home = draw(props(undefined));
  const card = home
    .getByRole("button", { name: "Hello Anchor" })
    .closest<HTMLElement>("[data-slot=action-card]");
  const eyebrow = card?.querySelector("[data-slot=action-card-eyebrow]");
  expect(eyebrow?.textContent).toBe("Beginner · Anchor");
  expect(eyebrow?.querySelector("[data-slot=tag]")).toBeNull();
});

it("writes the level alone for a tutorial with no framework", () => {
  const p = props(undefined);
  p.tutorials = [
    {
      name: "Bare",
      description: "Bare description",
      level: "Beginner",
      framework: undefined,
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
  const home = draw(props(undefined));
  for (const name of ["New project", "Follow a tutorial", "Open a program"]) {
    const media = home
      .getByRole("button", { name })
      .closest<HTMLElement>("[data-slot=action-card]")
      ?.querySelector("[data-slot=action-card-media]");
    expect(media?.getAttribute("data-variant")).toBe("glyph");
  }
});

it("opens the New project page from its tile", () => {
  const p = props(undefined);
  const home = draw(p);
  const tile = home.getByRole("button", { name: "New project" });
  expect(tile.hasAttribute("aria-expanded")).toBe(false);
  fireEvent.click(tile);
  expect(p.onTile).toHaveBeenCalledWith("new-project");
});

it("reports the other tiles", () => {
  const p = props(undefined);
  const home = draw(p);
  fireEvent.click(home.getByRole("button", { name: "Open a program" }));
  expect(p.onTile).toHaveBeenCalledWith("programs");
  fireEvent.click(home.getByRole("button", { name: "Follow a tutorial" }));
  expect(p.onTile).toHaveBeenCalledWith("tutorials");
});

it("opens a tutorial by name", async () => {
  const p = props(undefined);
  const home = draw(p);
  // Async: Open is an AsyncButton, which settles once `onTutorial` resolves
  await act(async () => {
    fireEvent.click(home.getByRole("button", { name: "Open Hello Anchor" }));
  });
  expect(p.onTutorial).toHaveBeenCalledWith("Hello Anchor");
});

it("opens a tutorial from its card, where the Open button is hidden below md", () => {
  const p = props(undefined);
  const home = draw(p);
  fireEvent.click(home.getByRole("button", { name: "Hello Anchor" }));
  expect(p.onTutorial).toHaveBeenCalledWith("Hello Anchor");
});

it("opens the assistant from the composer", () => {
  const p = props(undefined);
  const home = draw(p);
  fireEvent.click(home.getByRole("button", { name: "Ask the assistant" }));
  expect(p.onAsk).toHaveBeenCalledTimes(1);
});

it("lays out the prototype's 736 px column, 20 px apart, with its send", () => {
  draw(props(undefined));
  const home = screen.getByRole("region", { name: "Home" });
  // min(50rem, 100%) less 2rem a side
  expect(home.className).toMatch(/\bmax-w-\[50rem\]/);
  expect(home.className).toMatch(/\bpx-8\b/);
  expect(home.className).toMatch(/\bgap-5\b/);
  expect(home.querySelector('[data-slot="logo-play"]')).not.toBeNull();
});

it("lets its send open the assistant too", () => {
  const p = props(undefined);
  const home = draw(p);
  fireEvent.click(home.getByRole("button", { name: "Send" }));
  expect(p.onAsk).toHaveBeenCalledTimes(1);
});

it("offers the example on a first visit, ahead of the composer", async () => {
  const onRun = vi.fn().mockResolvedValue(undefined);
  const home = draw(props({ kind: "example", onRun }));
  const example = within(home.getByRole("region", { name: "Try an example" }));
  expect(
    example.getByText(
      "This program saves a number in an account and writes it to the logs."
    )
  ).toBeTruthy();
  const run = example.getByRole("button", { name: "Run it" });
  const ask = home.getByRole("button", { name: "Ask the assistant" });
  // Tab reaches Run it before the composer (spec `client-v2-first-run`)
  expect(
    run.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  fireEvent.click(run);
  // A second press while the first runs does nothing
  fireEvent.click(run);
  await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1));
  expect(
    home.queryByRole("region", { name: "Pick up where you left off" })
  ).toBeNull();
});

it("lists recent work on a return visit, and opens a row", async () => {
  const onOpen = vi.fn().mockResolvedValue(undefined);
  const entries = [
    { name: "a", kind: "project" as const, current: true },
    { name: "Hello Anchor", kind: "tutorial" as const, current: false },
  ];
  const progressOf = (): TutorialProgress => ({
    state: "started",
    page: 2,
    pages: 4,
  });
  const home = draw(props({ kind: "recent", entries, progressOf, onOpen }));
  expect(home.queryByRole("region", { name: "Try an example" })).toBeNull();
  const recent = within(
    home.getByRole("region", { name: "Pick up where you left off" })
  );
  expect(recent.getByText("Open now")).toBeTruthy();
  expect(recent.getByText("Project")).toBeTruthy();
  expect(recent.getByText("Tutorial · 2 of 4")).toBeTruthy();
  fireEvent.click(recent.getByRole("button", { name: "Open Hello Anchor" }));
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith(entries[1]));
});

it("shows neither section when there is nothing to offer", () => {
  const home = draw(props(undefined));
  expect(home.queryByRole("region", { name: "Try an example" })).toBeNull();
  expect(
    home.queryByRole("region", { name: "Pick up where you left off" })
  ).toBeNull();
});

it("offers to check the account again once the automatic re-reads are spent", async () => {
  const onRetry = vi.fn().mockResolvedValue(undefined);
  const home = draw(props({ kind: "retry", onRetry }));
  expect(home.getByRole("status").textContent).toContain(
    "We could not check your account."
  );
  expect(home.queryByRole("region", { name: "Try an example" })).toBeNull();
  fireEvent.click(home.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
});
