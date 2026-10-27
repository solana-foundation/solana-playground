import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TutorialProgress } from "@/entities/tutorial";
import BaseTutorialCard from "./BaseTutorialCard";
import type { BaseTutorialCardProps } from "./BaseTutorialCard";

/** Hello Anchor's card at `progress`, with this Open and busy state */
const props = (
  progress: TutorialProgress,
  {
    open,
    busy = false,
  }: Pick<BaseTutorialCardProps, "open"> & {
    busy?: boolean;
  } = {}
): BaseTutorialCardProps => ({
  title: "Hello Anchor",
  description: "Hello world program with Anchor framework",
  caption: "Beginner · Anchor",
  framework: "Anchor",
  progress,
  open,
  busy,
  onOpen: vi.fn(async () => {}),
});

describe("BaseTutorialCard", () => {
  it("opens a new tutorial and shows no progress", () => {
    render(<BaseTutorialCard {...props({ state: "new" })} />);
    expect(
      screen.getByRole("button", { name: "Open Hello Anchor" })
    ).toBeTruthy();
    expect(screen.queryByText(/\d+ of \d+/)).toBeNull();
    expect(screen.getByText("Beginner · Anchor")).toBeTruthy();
    expect(
      screen.getByText("Hello world program with Anchor framework")
    ).toBeTruthy();
  });

  it("continues a started tutorial and shows the page it is on", () => {
    render(
      <BaseTutorialCard {...props({ state: "started", page: 2, pages: 5 })} />
    );
    expect(
      screen.getByRole("button", { name: "Continue Hello Anchor" })
    ).toBeTruthy();
    expect(screen.getByText("2 of 5")).toBeTruthy();
  });

  it("marks a completed tutorial with a tick and no progress", () => {
    const { container } = render(
      <BaseTutorialCard {...props({ state: "completed" })} />
    );
    expect(
      screen.getByRole("button", { name: "Hello Anchor completed. Open it" })
    ).toBeTruthy();
    expect(container.querySelector("[data-card-tick]")).not.toBeNull();
    // On a phone too: the tick stays where other cards draw a chevron
    expect(container.querySelector("[data-card-chevron]")).toBeNull();
    expect(screen.queryByText(/\d+ of \d+/)).toBeNull();
  });

  it("shows a failed Open on the card", () => {
    render(
      <BaseTutorialCard
        {...props(
          { state: "new" },
          { open: { state: "failed", message: "boom" } }
        )}
      />
    );
    expect(screen.getByRole("alert").textContent).toBe("boom");
  });

  it("shows what a running Open is doing", () => {
    render(
      <BaseTutorialCard
        {...props(
          { state: "new" },
          { open: { state: "running", text: "Opening…" } }
        )}
      />
    );
    expect(screen.getByText("Opening…")).toBeTruthy();
  });

  it("waits while an Open runs", () => {
    render(<BaseTutorialCard {...props({ state: "new" }, { busy: true })} />);
    expect(
      screen
        .getByRole("button", { name: "Open Hello Anchor" })
        .hasAttribute("disabled")
    ).toBe(true);
  });

  it("opens once per press", () => {
    const p = props({ state: "new" });
    render(<BaseTutorialCard {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Hello Anchor" }));
    expect(p.onOpen).toHaveBeenCalledTimes(1);
  });

  it("is one card with one button, and ends in a chevron on a phone", () => {
    const { container } = render(
      <BaseTutorialCard {...props({ state: "new" })} />
    );
    expect(container.querySelector('[data-slot="action-card"]')).not.toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(container.querySelector("[data-card-chevron]")).not.toBeNull();
  });
});
