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
      "Your program on devnet is tied to this browser's wallet"
    );
    fireEvent.click(screen.getByRole("button", { name: "Save keypair" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
