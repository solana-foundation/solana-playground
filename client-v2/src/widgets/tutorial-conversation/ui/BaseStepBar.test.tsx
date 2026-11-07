/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { StepBarItem } from "@/features/tutorial-conversation";

import type { BaseStepBarProps } from "./BaseStepBar";
import BaseStepBar from "./BaseStepBar";

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
  onJump: over.onJump ?? vi.fn(),
});

/** The step bar's segments, first to last */
const segments = () =>
  Array.from(
    screen
      .getByRole("navigation", { name: "Tutorial steps" })
      .querySelectorAll("[data-step-segment]")
  ) as HTMLButtonElement[];

/** The one line over the segments, which opens the steps' menu */
const trigger = () =>
  screen
    .getByRole("navigation", { name: "Tutorial steps" })
    .querySelector("button:not([data-step-segment])") as HTMLButtonElement;

const allDone = () => onStep3.map((s) => step(s.id, s.short, s.title, "done"));

describe("BaseStepBar", () => {
  it("is one trigger, 'Step n of m · <short>', over one unlabelled segment per step", () => {
    render(<BaseStepBar {...props()} />);
    expect(trigger().textContent).toBe("Step 3 of 4·Client");
    expect(segments()).toHaveLength(4);
    expect(segments().map((b) => b.textContent)).toEqual(["", "", "", ""]);
  });

  it("names each step's state in its segment's label, and disables the ones not reached", () => {
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

  it("lights a segment per step entered", () => {
    render(<BaseStepBar {...props()} />);
    expect(segments().map((b) => b.dataset.lit)).toEqual([
      "true",
      "true",
      "true",
      "false",
    ]);
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

  it("jumps from a done or current segment, never from one not reached", async () => {
    const onJump = vi.fn();
    render(<BaseStepBar {...props({ onJump })} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Step 1 of 4, Program, done" })
    );
    expect(onJump).toHaveBeenCalledWith(0, "bar");
    await userEvent.click(
      screen.getByRole("button", { name: "Step 4 of 4, Name argument" })
    );
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it("opens a menu from the trigger that marks the steps Done and Now", async () => {
    const onJump = vi.fn();
    render(<BaseStepBar {...props({ onJump })} />);
    await userEvent.click(trigger());
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "ProgramDone",
      "Build & DeployDone",
      "3ClientNow",
      "4Name argument",
    ]);
    expect(items[3].getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(items[1]);
    expect(onJump).toHaveBeenCalledWith(1, "menu");
  });

  it("reads 'Done · m of m' after the finish, every segment lit, the last step live", () => {
    render(<BaseStepBar {...props({ steps: allDone(), live: 3 })} />);
    expect(trigger().textContent).toBe("Done · 4 of 4");
    expect(segments().every((b) => b.dataset.lit === "true")).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Step 4 of 4, Name argument, done" })
        .getAttribute("aria-current")
    ).toBe("step");
  });

  it("reads the step count before Start, with nothing to open and nothing lit", () => {
    const fresh = onStep3.map((s) =>
      step(s.id, s.short, s.title, "not_reached")
    );
    render(<BaseStepBar {...props({ steps: fresh, live: null })} />);
    expect(trigger().textContent).toBe("4 steps");
    expect(trigger().disabled).toBe(true);
    expect(segments().every((b) => b.dataset.lit === "false")).toBe(true);
  });
});
