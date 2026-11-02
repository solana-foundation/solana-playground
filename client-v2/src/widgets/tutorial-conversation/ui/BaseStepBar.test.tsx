import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { StepBarItem } from "@/features/tutorial-conversation";
import BaseStepBar from "./BaseStepBar";
import type { BaseStepBarProps } from "./BaseStepBar";

const step = (
  id: string,
  short: string,
  title: string,
  state: StepBarItem["state"]
): StepBarItem => ({ id, short, title, state, took: null });

/** Hello Anchor's four steps, the third one live */
const onStep3 = [
  step("program", "Program", "Program", "done"),
  step("deploy", "Deploy", "Build & Deploy", "done"),
  step("client", "Client", "Client", "current"),
  step("name", "Name", "Name argument", "not_reached"),
];

const props = (over: Partial<BaseStepBarProps> = {}): BaseStepBarProps => ({
  steps: over.steps ?? onStep3,
  live: over.live === undefined ? 2 : over.live,
  viewing: over.viewing ?? null,
  progress: over.progress ?? 0.5,
  narrow: over.narrow ?? false,
  onJump: over.onJump ?? vi.fn(),
});

describe("BaseStepBar", () => {
  it("is a nav of one button per step, labelled with its short label", () => {
    render(<BaseStepBar {...props()} />);
    const nav = screen.getByRole("navigation", { name: "Tutorial steps" });
    const buttons = nav.querySelectorAll("button");
    expect([...buttons].map((b) => b.textContent)).toEqual([
      "Program",
      "Deploy",
      "3Client",
      "4Name",
    ]);
  });

  it("names each step's state in its label, and disables the ones not reached", () => {
    render(<BaseStepBar {...props()} />);
    expect(
      screen.getByRole("button", { name: "Step 1 of 4, Program, done" })
    ).toBeTruthy();
    const current = screen.getByRole("button", {
      name: "Step 3 of 4, Client, current",
    });
    expect(current.getAttribute("aria-current")).toBe("step");
    const ahead = screen.getByRole("button", {
      name: "Step 4 of 4, Name argument",
    }) as HTMLButtonElement;
    expect(ahead.disabled).toBe(true);
  });

  it("marks the step the feed is scrolled into as the location, and keeps the live one current", () => {
    render(<BaseStepBar {...props({ viewing: 0 })} />);
    expect(
      screen
        .getByRole("button", { name: "Step 1 of 4, Program, done" })
        .getAttribute("aria-current")
    ).toBe("location");
    expect(
      screen
        .getByRole("button", { name: "Step 3 of 4, Client, current" })
        .getAttribute("aria-current")
    ).toBe("step");
  });

  it("jumps from a done or current segment", async () => {
    const onJump = vi.fn();
    render(<BaseStepBar {...props({ onJump })} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Step 1 of 4, Program, done" })
    );
    expect(onJump).toHaveBeenCalledWith(0, "bar");
  });

  it("grows the hairline with the progress", () => {
    render(<BaseStepBar {...props({ progress: 0.625 })} />);
    expect(screen.getByTestId("step-bar-progress").style.width).toBe("62.5%");
  });

  it("is one button when narrow, whose menu marks the steps Done and Now", async () => {
    const onJump = vi.fn();
    render(<BaseStepBar {...props({ narrow: true, onJump })} />);
    const trigger = screen.getByRole("button", { name: /Step 3 of 4/ });
    expect(trigger.textContent).toBe("Step 3 of 4·Client");

    await userEvent.click(trigger);
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "ProgramDone",
      "Build & DeployDone",
      "3ClientNow",
      "4Name argument",
    ]);
    await userEvent.click(items[1]);
    expect(onJump).toHaveBeenCalledWith(1, "menu");
  });

  it("keeps the last step live after the finish, when no step is current", () => {
    const finished = onStep3.map((s) => step(s.id, s.short, s.title, "done"));
    const { unmount } = render(
      <BaseStepBar {...props({ steps: finished, live: 3 })} />
    );
    expect(
      screen
        .getByRole("button", { name: "Step 4 of 4, Name argument, done" })
        .getAttribute("aria-current")
    ).toBe("step");
    unmount();

    render(
      <BaseStepBar {...props({ steps: finished, live: 3, narrow: true })} />
    );
    expect(
      screen.getByRole("button", { name: /Step 4 of 4/ }).textContent
    ).toBe("Step 4 of 4·Name");
  });

  it("reads the step count before Start, with nothing to open", () => {
    const fresh = onStep3.map((s) =>
      step(s.id, s.short, s.title, "not_reached")
    );
    render(
      <BaseStepBar {...props({ steps: fresh, live: null, narrow: true })} />
    );
    const trigger = screen.getByRole("button", {
      name: "4 steps",
    }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
  });
});
