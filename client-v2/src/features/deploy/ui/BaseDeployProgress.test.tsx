// The run's steps as the stage draws them, from props alone.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import BaseDeployProgress from "./BaseDeployProgress";
import type { DeployRunState } from "@/commands/deploy/run";

const at = (state: DeployRunState) => {
  render(<BaseDeployProgress state={state} />);
  const list = screen.getByRole("status", { name: "Deploy progress" });
  return within(list)
    .getAllByRole("listitem")
    .map((li) => `${li.textContent} ${li.dataset.status}`);
};

describe("BaseDeployProgress", () => {
  it("shows the write percent with earlier steps done", () => {
    expect(
      at({ step: "write", percent: 62, funds: false, upgrade: false })
    ).toEqual([
      "Preparing buffer done",
      "Writing program, 62% running",
      "Deploying waiting",
    ]);
  });

  it("leads with funding only when the run funds the wallet, and upgrades a program that exists", () => {
    expect(
      at({ step: "funding", percent: 0, funds: true, upgrade: true })
    ).toEqual([
      "Funding wallet running",
      "Preparing buffer waiting",
      "Writing program, 0% waiting",
      "Upgrading waiting",
    ]);
  });
});
