import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils", () => ({}));

import Stepper from "./Stepper";
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
};

/** jsdom has no `matchMedia`; this stands in for it, matching only `narrow` */
const stubMatchMedia = (narrow: boolean) => {
  const matchMedia = (q: string) => ({
    matches: narrow && q === "(max-width: 80rem)",
    media: q,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMedia,
  });
};

describe("Stepper", () => {
  beforeEach(() => {
    stubMatchMedia(false);
    // the thumb measures its tabs with one; jsdom has none
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
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

  it("goes compact below 80rem", () => {
    stubMatchMedia(true);
    render(<Stepper state={INITIAL_FLOW_STATE} onSelect={() => {}} />);
    expect(screen.getByRole("tablist").getAttribute("data-compact")).toBe(
      "true"
    );
  });
});
