// The question before a link's first Run, drawn from props alone
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BaseRunConfirmProps } from "./BaseRunConfirm";
import BaseRunConfirm from "./BaseRunConfirm";

const LINK = {
  name: "quickstart.ts",
  code: 'import { createClient } from "@solana/kit";\nconsole.log("Step 1");',
  from: "https://solana.com/docs/quickstart",
};

const confirmFor = (link: BaseRunConfirmProps["link"]) => {
  const onRun = vi.fn();
  const onCancel = vi.fn();
  render(<BaseRunConfirm link={link} onRun={onRun} onCancel={onCancel} />);
  return { onRun, onCancel };
};
const confirm = () => confirmFor(LINK);

describe("BaseRunConfirm", () => {
  it("shows the file, its code, and the source as the link's claim", () => {
    confirm();
    const dialog = screen.getByRole("dialog", {
      name: "Run code from a link?",
    });
    expect(dialog.textContent).toContain("quickstart.ts");
    expect(dialog.textContent).toContain('console.log("Step 1");');
    expect(dialog.textContent).toContain(
      "The link says this code comes from solana.com. Playground can't check that."
    );
    expect(dialog.textContent).toContain("Playground wallet");
    expect(dialog.textContent).not.toMatch(/From solana\.com/);
  });

  it("names no host for a link with no source", () => {
    confirmFor({ name: LINK.name, code: LINK.code });
    expect(
      screen.getByText(/Playground can't check where this code came from/)
    ).toBeTruthy();
  });

  it("focuses Cancel, so Enter runs nothing", () => {
    confirm();
    expect(document.activeElement?.textContent).toBe("Cancel");
  });

  it("runs on Run and runs nothing on Cancel", () => {
    const { onRun, onCancel } = confirm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRun).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape", () => {
    const { onCancel } = confirm();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("draws nothing with no link", () => {
    confirmFor(undefined);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
