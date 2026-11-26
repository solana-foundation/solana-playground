// The keypair backup line and its two answers.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BaseBackupLine from "./BaseBackupLine";

describe("BaseBackupLine", () => {
  it("names the network and passes each answer on", () => {
    const onSave = vi.fn();
    const onDismiss = vi.fn();
    render(
      <BaseBackupLine cluster="devnet" onSave={onSave} onDismiss={onDismiss} />
    );

    expect(screen.getByLabelText("Keypair backup").textContent).toContain(
      "Your program on devnet is tied to this browser's Playground wallet."
    );
    fireEvent.click(screen.getByRole("button", { name: "Save keypair" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("puts the key page's own button in place of Save keypair when given one", () => {
    const onSave = vi.fn();
    render(
      <BaseBackupLine
        cluster="devnet"
        onSave={onSave}
        onDismiss={vi.fn()}
        save={<button type="button">The key page's Save keypair</button>}
      />
    );

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "The key page's Save keypair",
      "Not now",
    ]);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("draws Not now quiet, so Save keypair reads as the action", () => {
    render(
      <BaseBackupLine cluster="devnet" onSave={vi.fn()} onDismiss={vi.fn()} />
    );
    const classes = (name: string) =>
      screen.getByRole("button", { name }).className.split(" ");

    expect(classes("Not now")).toContain("bg-transparent");
    expect(classes("Save keypair")).not.toContain("bg-transparent");
  });
});
