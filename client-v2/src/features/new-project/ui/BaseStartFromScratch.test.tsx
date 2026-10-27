import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import BaseStartFromScratch from "./BaseStartFromScratch";
import type { BaseStartFromScratchProps } from "./BaseStartFromScratch";

// The framework picker measures its indicator with a `ResizeObserver`, which
// jsdom lacks
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
afterEach(() => vi.unstubAllGlobals());

const FRAMEWORKS: BaseStartFromScratchProps["frameworks"] = [
  { name: "Anchor", icon: "/anchor.png" },
  { name: "Native", icon: "/native.png", circle: true },
];

const draw = (props: Partial<BaseStartFromScratchProps> = {}) => {
  const handlers = {
    onFramework: vi.fn(),
    onName: vi.fn(),
    onStart: vi.fn(),
  };
  render(
    <BaseStartFromScratch
      frameworks={FRAMEWORKS}
      framework={props.framework ?? "Anchor"}
      onFramework={handlers.onFramework}
      name={props.name ?? ""}
      onName={handlers.onName}
      placeholder={props.placeholder ?? "anchor-project"}
      start={props.start ?? { state: "idle" }}
      onStart={handlers.onStart}
    />
  );
  return handlers;
};

const start = () => screen.getByRole("button", { name: /^Start/ });

it("offers each framework, the project name and Start", () => {
  draw();

  const picker = screen.getByLabelText("Framework");
  expect(picker.textContent).toContain("Anchor");
  expect(picker.textContent).toContain("Native");
  expect(screen.getByLabelText("Project name")).toHaveProperty(
    "placeholder",
    "anchor-project"
  );
  expect(start().textContent).toBe("Start →");
  expect(screen.getByText("Start from scratch")).toBeTruthy();
});

it("hands a picked framework, a typed name and a press up", () => {
  const on = draw();

  fireEvent.click(screen.getByRole("radio", { name: /Native/ }));
  fireEvent.change(screen.getByLabelText("Project name"), {
    target: { value: "vault" },
  });
  fireEvent.click(start());

  expect(on.onFramework).toHaveBeenCalledWith("Native");
  expect(on.onName).toHaveBeenCalledWith("vault");
  expect(on.onStart).toHaveBeenCalledTimes(1);
});

it("starts on Enter in the name field", () => {
  const on = draw();

  fireEvent.keyDown(screen.getByLabelText("Project name"), { key: "Enter" });

  expect(on.onStart).toHaveBeenCalledTimes(1);
});

it("shows an error under the field", () => {
  draw({ start: { state: "invalid", error: "Invalid project name" } });

  expect(screen.getByRole("alert").textContent).toBe("Invalid project name");
  expect(
    screen.getByLabelText("Project name").getAttribute("aria-invalid")
  ).toBe("true");
});

it("keeps Start usable after a failed start, for a retry", () => {
  const on = draw({ start: { state: "failed", error: "offline" } });

  expect(screen.getByRole("alert").textContent).toBe("offline");
  fireEvent.click(start());
  expect(on.onStart).toHaveBeenCalledTimes(1);
});

it("holds Start while the name is refused", () => {
  const on = draw({
    start: { state: "invalid", error: "Invalid project name" },
  });

  fireEvent.keyDown(screen.getByLabelText("Project name"), { key: "Enter" });
  expect(start()).toHaveProperty("disabled", true);
  expect(on.onStart).not.toHaveBeenCalled();
});

it("holds Start while a project is being made", () => {
  draw({ start: { state: "creating" } });

  expect(start()).toHaveProperty("disabled", true);
  expect(start().getAttribute("aria-busy")).toBe("true");
});
