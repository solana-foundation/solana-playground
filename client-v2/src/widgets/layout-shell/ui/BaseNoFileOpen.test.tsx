import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import BaseNoFileOpen from "./BaseNoFileOpen";

it("says no file is open", () => {
  render(<BaseNoFileOpen onShowFiles={() => {}} />);
  expect(screen.getByRole("heading", { name: "No file open" })).toBeTruthy();
});

it("shows files on its one button", async () => {
  const onShowFiles = vi.fn();
  render(<BaseNoFileOpen onShowFiles={onShowFiles} />);
  await userEvent.click(screen.getByRole("button", { name: "Show files" }));
  expect(onShowFiles).toHaveBeenCalledTimes(1);
});
