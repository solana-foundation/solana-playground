import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import BaseClientProjectBar from "./BaseClientProjectBar";

const renderBar = (cluster: string | undefined) => {
  const onAddProgram = vi.fn(() => Promise.resolve());
  const onTest = vi.fn(() => Promise.resolve());
  render(
    <BaseClientProjectBar
      cluster={cluster}
      onAddProgram={onAddProgram}
      onAddProgramError={vi.fn()}
      onTest={onTest}
      onTestError={vi.fn()}
      run={<button type="button">Run</button>}
    />
  );
  return { onAddProgram, onTest };
};

it("labels a client project with its cluster and carries Add program, Test and Run", () => {
  renderBar("Devnet");

  expect(screen.getByText("Client project")).toBeTruthy();
  expect(screen.getByText("Devnet")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add program" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Test" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Run" })).toBeTruthy();
});

it("names no cluster before the endpoint is read", () => {
  renderBar(undefined);

  expect(document.getElementById("flow-client-cluster")).toBeNull();
});

it("hands Add program and Test to their actions", async () => {
  const { onAddProgram, onTest } = renderBar("Devnet");

  await userEvent.click(screen.getByRole("button", { name: "Add program" }));
  await userEvent.click(screen.getByRole("button", { name: "Test" }));

  expect(onAddProgram).toHaveBeenCalledOnce();
  expect(onTest).toHaveBeenCalledOnce();
});
