import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";
import SettingsBoundary from "./SettingsBoundary";

const Throws = (): null => {
  throw new Error("Invalid option value: [object Object]");
};

let logged: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  logged = memoryProvider();
  initLogger({ providers: [logged] });
  // React reports a caught render error on the console as well
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  resetLogger();
  vi.restoreAllMocks();
});

it("shows the settings until a control throws", () => {
  render(
    <SettingsBoundary onClose={vi.fn()}>
      <p>the sections</p>
    </SettingsBoundary>
  );
  screen.getByText("the sections");
});

it("a control that throws leaves a way back to the app, and is reported", async () => {
  const onClose = vi.fn();
  render(
    <SettingsBoundary onClose={onClose}>
      <Throws />
    </SettingsBoundary>
  );
  const page = within(screen.getByRole("region", { name: "Settings" }));
  page.getByText("The settings could not be shown.");
  await userEvent.click(page.getByRole("button", { name: "Back to app" }));
  expect(onClose).toHaveBeenCalledExactlyOnceWith("back");
  expect(logged.entries.some((e) => e.level === "panic")).toBe(true);
});

it("Escape leaves the notice, as it leaves the page", async () => {
  const onClose = vi.fn();
  render(
    <SettingsBoundary onClose={onClose}>
      <Throws />
    </SettingsBoundary>
  );
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledExactlyOnceWith("escape");
});
