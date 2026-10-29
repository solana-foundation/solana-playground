import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils", () => ({}));

import Stepper from "./Stepper";
import { STEPPER_FULL_WIDTH_PX } from "./stepper-width";
import { INITIAL_FLOW_STATE } from "../state/stage";
import type { FlowState } from "../state/stage";

const failedBuild: FlowState = {
  stage: "build",
  build: "failed",
  buildSettled: "upcoming",
  deploy: "upcoming",
  interact: "upcoming",
  buildErrorCount: 3,
  buildMs: null,
  buildStartedAt: 1000,
  buildFailure: null,
  deployBeforeRun: null,
  stopped: null,
};

/** Every element a `ResizeObserver` watches (the fold's stepper root, the
 * thumb's targets), each with a way to report a width for it */
const observed = new Map<Element, (width: number) => void>();

class StubResizeObserver {
  private readonly callback: ResizeObserverCallback;
  private readonly targets = new Set<Element>();
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.targets.add(target);
    observed.set(target, (width) =>
      this.callback(
        [{ target, contentRect: { width } } as ResizeObserverEntry],
        this as unknown as ResizeObserver
      )
    );
  }
  unobserve(target: Element) {
    this.targets.delete(target);
    observed.delete(target);
  }
  disconnect() {
    this.targets.forEach((target) => observed.delete(target));
    this.targets.clear();
  }
}

/** Gives the stepper root, and only it, this much room */
const resizeTo = (width: number) => {
  const root = document.querySelector('[data-slot="stepper"]')!;
  const fire = observed.get(root);
  if (!fire) throw new Error("the stepper root is not observed");
  act(() => fire(width));
};

describe("Stepper", () => {
  beforeEach(() => {
    observed.clear();
    // the thumb and the fold both measure with one; jsdom has none
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
  });

  it("is one tab list with a tab per stage, ids kept", () => {
    render(<Stepper state={INITIAL_FLOW_STATE} onSelect={() => {}} />);
    expect(
      screen.getByRole("tablist", { name: "Development loop" })
    ).toBeTruthy();
    const build = document.getElementById("flow-stage-tab-build")!;
    expect(build.getAttribute("role")).toBe("tab");
    expect(build.getAttribute("aria-controls")).toBe("flow-stage-panel-build");
    expect(build.getAttribute("data-slot")).toBe("stepper-item");
  });

  it("says a failed build's count and the lesson target", () => {
    render(<Stepper state={failedBuild} onSelect={() => {}} target="build" />);
    const name = "Build: failed, 3 errors, current lesson target";
    expect(screen.getByRole("tab", { name })).toBeTruthy();
    expect(
      screen.getByRole("tab", { name }).getAttribute("aria-selected")
    ).toBe("true");
  });

  it("selects a stage on click", async () => {
    const onSelect = vi.fn();
    render(<Stepper state={INITIAL_FLOW_STATE} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("tab", { name: /^Deploy:/ }));
    expect(onSelect).toHaveBeenCalledWith("deploy");
  });

  it("moves focus with the arrow keys without selecting", async () => {
    const onSelect = vi.fn();
    render(<Stepper state={INITIAL_FLOW_STATE} onSelect={onSelect} />);
    screen.getByRole("tab", { name: /^Write:/ }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement?.id).toBe("flow-stage-tab-build");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows the full labels before the first measurement", () => {
    render(<Stepper state={INITIAL_FLOW_STATE} onSelect={() => {}} />);
    expect(screen.getByRole("tablist").getAttribute("data-compact")).toBe(
      "false"
    );
  });

  it("folds to initials when its row is narrower than the full list", () => {
    render(<Stepper state={INITIAL_FLOW_STATE} onSelect={() => {}} />);
    resizeTo(STEPPER_FULL_WIDTH_PX - 1);
    expect(screen.getByRole("tablist").getAttribute("data-compact")).toBe(
      "true"
    );
    resizeTo(STEPPER_FULL_WIDTH_PX);
    expect(screen.getByRole("tablist").getAttribute("data-compact")).toBe(
      "false"
    );
  });

  it("keeps its labels while the stage bar is hidden (zero width)", () => {
    render(<Stepper state={INITIAL_FLOW_STATE} onSelect={() => {}} />);
    resizeTo(900);
    resizeTo(0);
    expect(screen.getByRole("tablist").getAttribute("data-compact")).toBe(
      "false"
    );
  });
});

describe("fill", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
  });

  it("stretches the list across the row, its stages sharing the width", () => {
    const { container, rerender } = render(
      <Stepper state={INITIAL_FLOW_STATE} onSelect={vi.fn()} fill />
    );
    const list = () =>
      container.querySelector('[data-slot="stepper-list"]')!.className;
    expect(list()).toMatch(/\bw-full\b/);
    rerender(<Stepper state={INITIAL_FLOW_STATE} onSelect={vi.fn()} />);
    expect(list()).not.toMatch(/\bw-full\b/);
  });
});

describe("phone", () => {
  beforeEach(() => {
    observed.clear();
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
  });

  it("shows Build, Deploy and Interact in full, Write being the code's page", () => {
    render(<Stepper state={INITIAL_FLOW_STATE} onSelect={vi.fn()} phone />);
    expect(screen.queryByRole("tab", { name: /^Write:/ })).toBeNull();
    expect(
      screen.getAllByRole("tab").map((tab) => tab.id.replace(/^.*-/, ""))
    ).toEqual(["build", "deploy", "interact"]);
    resizeTo(STEPPER_FULL_WIDTH_PX - 1);
    expect(screen.getByRole("tablist").getAttribute("data-compact")).toBe(
      "false"
    );
  });
});
