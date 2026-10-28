// The sign-out dialog: what it says leaves the browser, and where focus lands.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BaseSignOutDialog from "./BaseSignOutDialog";

describe("BaseSignOutDialog", () => {
  it("says what leaves the browser and what stays", () => {
    render(
      <BaseSignOutDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />
    );
    const dialog = screen.getByRole("dialog", {
      name: "Sign out of Playground?",
    });
    expect(dialog.textContent).toContain(
      "Projects saved to your account leave this browser. Anything not saved stays here."
    );
  });

  it("opens with focus on Cancel", () => {
    render(
      <BaseSignOutDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" })
    );
  });
});
