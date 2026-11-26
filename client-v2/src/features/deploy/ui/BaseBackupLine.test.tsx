// The keypair backup line and its two answers.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CalloutAction } from "@/shared/ui/callout";

import BaseBackupLine from "./BaseBackupLine";

describe("BaseBackupLine", () => {
  it("names the network, holds the Save keypair it is given and passes Not now on", () => {
    const onSave = vi.fn();
    const onDismiss = vi.fn();
    render(
      <BaseBackupLine
        cluster="devnet"
        save={<CalloutAction onClick={onSave}>Save keypair</CalloutAction>}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByLabelText("Keypair backup").textContent).toContain(
      "Your program on devnet is tied to this browser's Playground wallet."
    );
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Save keypair",
      "Not now",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Save keypair" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("draws Not now quiet, so Save keypair reads as the action", () => {
    render(
      <BaseBackupLine
        cluster="devnet"
        save={<CalloutAction>Save keypair</CalloutAction>}
        onDismiss={vi.fn()}
      />
    );
    const classes = (name: string) =>
      screen.getByRole("button", { name }).className.split(" ");

    expect(classes("Not now")).toContain("bg-transparent");
    expect(classes("Save keypair")).not.toContain("bg-transparent");
  });
});
