import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { LoggerErrorBoundary } from "@/shared/lib/logger";

import { CrashFallback } from "./CrashFallback";

const Crash = (): never => {
  throw new Error("render failed");
};

it("should name the app and offer a reload when a render throws", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const reload = vi.fn();
  render(
    <LoggerErrorBoundary fallback={<CrashFallback reload={reload} />}>
      <Crash />
    </LoggerErrorBoundary>
  );

  expect(screen.getByRole("alert").textContent).toContain(
    "Playground stopped for a reason we can't name. Reload the page."
  );
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(reload).toHaveBeenCalledOnce();
});
