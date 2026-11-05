import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { TutorialItem } from "../model/use-tutorial-list";
import BaseTutorialLevels from "./BaseTutorialLevels";

// The entity's entry reaches the store; the card needs only its cover
vi.mock("@/entities/tutorial", async () => ({
  TutorialCover: (await import("@/entities/tutorial/ui/art/TutorialCover"))
    .default,
}));

const beginner = (n: number): TutorialItem => ({
  id: `Tutorial ${n}`,
  title: `Tutorial ${n}`,
  description: "d",
  framework: "Anchor",
  level: "Beginner",
  authors: [],
  progress: { state: "new" },
  pages: 3,
  lesson: undefined,
  open: undefined,
});

const five = [1, 2, 3, 4, 5].map(beginner);
const draw = (searching: boolean) =>
  render(
    <BaseTutorialLevels
      items={five}
      searching={searching}
      busy={false}
      onOpen={async () => {}}
    />
  );
const cards = () => screen.getAllByRole("button", { name: /^Open Tutorial/ });

it("shows a level's first four, and the rest in place on Show all", () => {
  draw(false);
  expect(cards()).toHaveLength(4);

  fireEvent.click(screen.getByRole("button", { name: "Show all" }));

  expect(cards()).toHaveLength(5);
  const less = screen.getByRole("button", { name: "Show less" });
  expect(less.getAttribute("aria-expanded")).toBe("true");
});

it("shows every match while searching, with no Show all", () => {
  draw(true);
  expect(cards()).toHaveLength(5);
  expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
});
