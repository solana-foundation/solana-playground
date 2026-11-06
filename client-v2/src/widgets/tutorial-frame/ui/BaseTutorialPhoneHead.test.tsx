/* eslint-disable unicorn/no-null -- the live step is null before Start, as the conversation hands it */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  BaseTutorialPhoneHeadProps,
  PhoneStep,
} from "./BaseTutorialPhoneHead";
import BaseTutorialPhoneHead from "./BaseTutorialPhoneHead";

const step = (index: number, state: PhoneStep["state"]): PhoneStep => ({
  id: `s${index + 1}`,
  short: ["Program", "Deploy", "Client", "Greet"][index],
  title: ["Write the program", "Deploy it", "Call it", "Greet by name"][index],
  objective: `Objective ${index + 1}`,
  state,
  took: null,
});

const STEPS: PhoneStep[] = [
  step(0, "done"),
  step(1, "current"),
  step(2, "not_reached"),
  step(3, "not_reached"),
];
const UNREACHED = [0, 1, 2, 3].map((i) => step(i, "not_reached"));
const DONE = [0, 1, 2, 3].map((i) => step(i, "done"));

const draw = (over: Partial<BaseTutorialPhoneHeadProps>) => {
  const props: BaseTutorialPhoneHeadProps = {
    name: "Hello Anchor",
    steps: STEPS,
    live: 1,
    started: true,
    finished: false,
    minutes: 12,
    space: "chat",
    dot: false,
    passed: 1,
    onBack: vi.fn(),
    onSpace: vi.fn(),
    onJump: vi.fn(),
    onStartOver: vi.fn(async () => {}),
  };
  Object.assign(props, over);
  const { container, rerender, unmount } = render(
    <BaseTutorialPhoneHead {...props} />
  );
  return { container, rerender, unmount, props };
};

const openSteps = () =>
  userEvent.click(screen.getByRole("button", { name: /^Hello Anchor, / }));

describe("BaseTutorialPhoneHead", () => {
  it("names no size until the conversation has its steps", () => {
    draw({ steps: [], live: null, started: false, minutes: 0 });
    expect(
      screen.getByRole("button", { name: "Hello Anchor. Show the steps" })
    ).toBeTruthy();
    expect(screen.queryByText(/0 steps/)).toBeNull();
  });

  it("says where the learner is: before Start, on a step, and done", () => {
    const { rerender, props } = draw({
      started: false,
      live: null,
      steps: UNREACHED,
    });
    expect(screen.getByText("4 steps · 12 min")).toBeTruthy();

    rerender(
      <BaseTutorialPhoneHead {...props} started live={1} steps={STEPS} />
    );
    expect(screen.getByText("Step 2 of 4 · Deploy")).toBeTruthy();

    rerender(
      <BaseTutorialPhoneHead
        {...props}
        started
        finished
        live={3}
        steps={DONE}
      />
    );
    expect(screen.getByText("Done · 4 of 4")).toBeTruthy();
  });

  it("draws a hairline before Start and the step track after it", () => {
    const { container, rerender, props } = draw({ started: false, live: null });
    expect(container.querySelectorAll("[data-segment]")).toHaveLength(0);
    expect(container.querySelector("[data-hairline]")).toBeTruthy();

    rerender(<BaseTutorialPhoneHead {...props} started live={1} />);
    const segments = container.querySelectorAll("[data-segment]");
    expect(segments).toHaveLength(4);
    expect(Array.from(segments).map((s) => s.getAttribute("data-lit"))).toEqual(
      ["true", "true", "false", "false"]
    );
  });

  it("names the space the toggle goes to", async () => {
    const { rerender, props } = draw({});
    await userEvent.click(
      screen.getByRole("button", { name: /show the code/i })
    );
    expect(screen.getByText("Code")).toBeTruthy();
    expect(props.onSpace).toHaveBeenCalledWith("code", "toggle");

    rerender(<BaseTutorialPhoneHead {...props} space="code" />);
    expect(screen.getByText("Chat")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Back to the chat" })
    );
    expect(props.onSpace).toHaveBeenLastCalledWith("chat", "toggle");
  });

  it("marks Code only while the assistant has written unseen lines", () => {
    const { container, rerender, props } = draw({});
    expect(container.querySelector("[data-dot]")).toBeNull();
    rerender(<BaseTutorialPhoneHead {...props} dot />);
    expect(container.querySelector("[data-dot]")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Show the code, new lines written" })
    ).toBeTruthy();
  });

  it("lists the steps with their objectives, the current one now and unreached ones shut", async () => {
    draw({});
    await openSteps();
    const sheet = screen.getByRole("dialog", { name: "Hello Anchor" });
    expect(
      within(sheet).getByText("1 of 4 steps done. Tap one to read it again.")
    ).toBeTruthy();
    const rows = within(sheet).getAllByRole("button", { name: /Objective/ });
    expect(rows).toHaveLength(4);
    STEPS.forEach((s) =>
      expect(within(sheet).getByText(s.objective)).toBeTruthy()
    );
    expect(within(rows[0]).getByText("Done")).toBeTruthy();
    expect(within(rows[1]).getByText("Now")).toBeTruthy();
    expect(rows[1].getAttribute("aria-current")).toBe("step");
    expect((rows[2] as HTMLButtonElement).disabled).toBe(true);
    expect((rows[3] as HTMLButtonElement).disabled).toBe(true);
  });

  it("takes a picked step back to the chat, jumps to it and closes the sheet", async () => {
    const { props } = draw({});
    await openSteps();
    await userEvent.click(
      screen.getByRole("button", { name: /Write the program/ })
    );
    expect(props.onSpace).toHaveBeenCalledWith("chat", "step");
    expect(props.onJump).toHaveBeenCalledWith(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers Start over only once started, and asks first", async () => {
    const { rerender, props } = draw({
      started: false,
      live: null,
      steps: UNREACHED,
    });
    await openSteps();
    expect(screen.queryByRole("button", { name: "Start over…" })).toBeNull();
    await userEvent.keyboard("{Escape}");

    rerender(
      <BaseTutorialPhoneHead {...props} started live={1} steps={STEPS} />
    );
    await openSteps();
    await userEvent.click(screen.getByRole("button", { name: "Start over…" }));
    const dialog = screen.getByRole("dialog", {
      name: "Start Hello Anchor over?",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Start over" })
    );
    expect(props.onStartOver).toHaveBeenCalledTimes(1);
  });

  it("closes the sheet on Back and keeps the progress", async () => {
    const { props, unmount } = draw({});
    await openSteps();
    // The sheet is modal, so the press reaches past it, as the system's back does
    fireEvent.click(
      screen.getByRole("button", { name: "Back to tutorials", hidden: true })
    );
    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onStartOver).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("leaves no sheet over the next page when the header goes with it open", async () => {
    const { unmount } = draw({});
    await openSteps();
    unmount();
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });
});
