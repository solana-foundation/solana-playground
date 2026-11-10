import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";

describe("DialogContent", () => {
  afterEach(cleanup);

  const open = () =>
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Share</DialogTitle>
          <DialogDescription>Copy the link.</DialogDescription>
          <button>Copy</button>
        </DialogContent>
      </Dialog>
    );

  it("sends Shift+Tab from its own frame to the last control", async () => {
    const user = userEvent.setup();
    open();
    // A click on the dialog's body leaves the focus on the frame
    screen.getByRole("dialog").focus();

    await user.tab({ shift: true });

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close" })
    );
  });

  it("leaves Shift+Tab between controls to the focus trap", async () => {
    const user = userEvent.setup();
    open();
    screen.getByRole("button", { name: "Close" }).focus();

    await user.tab({ shift: true });

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Copy" })
    );
  });
});
