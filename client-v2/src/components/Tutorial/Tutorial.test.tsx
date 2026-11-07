import { render } from "@testing-library/react";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Tutorial } from "./Tutorial";

// The utils barrel needs build-time globals the unit runner does not define.
const tutorial = vi.hoisted(() => ({
  current: { name: "Test" } as { name: string } | null,
  isStarted: () => true,
  start: async () => {},
}));
vi.mock("../../utils", () => ({
  PgTheme: { convertToCSS: () => "", getScrollbarCSS: () => "" },
  PgTutorial: tutorial,
}));
vi.mock("../../hooks", () => ({ useRenderOnChange: () => {} }));

// The test needs only the tutorial's mount effect, not the page it shows.
vi.mock("./views", () => ({ About: () => null, Main: () => null }));

const renderWith = (onMount: () => unknown) =>
  render(<Tutorial about="About" pages={[]} files={[]} onMount={onMount} />);

describe("Tutorial onMount", () => {
  // React reports a bad cleanup on the console; a passing run logs nothing.
  let error: MockInstance<typeof console.error>;
  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["an assigned value", () => "Test"],
    ["a promise", async () => {}],
  ])("does not take %s the hook returns for a cleanup", (_, onMount) => {
    const { unmount } = renderWith(onMount);

    expect(() => unmount()).not.toThrow();
    expect(error).not.toHaveBeenCalled();
  });

  it("runs a function the hook returns when the tutorial unmounts", () => {
    const cleanup = vi.fn();
    const { unmount } = renderWith(() => cleanup);
    expect(cleanup).not.toHaveBeenCalled();

    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });
});

describe("Tutorial on leaving", () => {
  let error: MockInstance<typeof console.error>;
  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    tutorial.current = { name: "Test" };
  });

  // Navigating away from the tutorial's path clears `current` (it is derived
  // from the path) and re-renders this view once before the route unmounts it.
  it("renders nothing and logs nothing once the current tutorial is cleared", () => {
    const cleanup = vi.fn();
    const onMount = () => cleanup;
    const { container, rerender, unmount } = render(
      <Tutorial about="About" pages={[]} files={[]} onMount={onMount} />
    );

    // eslint-disable-next-line unicorn/no-null -- the derivable clears to null
    tutorial.current = null;
    rerender(
      <Tutorial about="About" pages={[]} files={[]} onMount={onMount} />
    );
    expect(container.innerHTML).toBe("");

    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });
});
