import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import BaseTutorialsPage from "./BaseTutorialsPage";

// The entity's entry reaches the store; the card needs only its cover
vi.mock("@/entities/tutorial", async () => ({
  TutorialCover: (await import("@/entities/tutorial/ui/art/TutorialCover"))
    .default,
}));

/** The page with this query in its search and nothing listed */
const drawWith = (query: string) =>
  render(
    <BaseTutorialsPage
      query={query}
      onQuery={() => {}}
      framework="all"
      onFramework={() => {}}
      filterable={false}
      count={3}
      items={[]}
      busy={false}
      onOpen={async () => {}}
    />
  );

it("folds the search while nothing is asked", () => {
  drawWith("");
  expect(screen.getByRole("button", { name: "Search tutorials" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
});

it("keeps the field in sight while a query is on", () => {
  drawWith("lumber");
  expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Search tutorials" })).toBeNull();
});
