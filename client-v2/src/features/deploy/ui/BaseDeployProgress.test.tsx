// The run's steps as the stage draws them, from props alone.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DeployRunState } from "@/commands/deploy/run";

import BaseDeployProgress from "./BaseDeployProgress";

// eslint-disable-next-line unicorn/no-null -- `DeployRunState.approval` is `null` while none is asked
const NO_APPROVAL = null;

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
      at({
        step: "write",
        percent: 62,
        funds: false,
        upgrade: false,
        approval: NO_APPROVAL,
      })
    ).toEqual([
      "Preparing buffer done",
      "Writing program, 62% running",
      "Deploying waiting",
    ]);
  });

  it("leads with funding only when the run funds the wallet, and upgrades a program that exists", () => {
    expect(
      at({
        step: "funding",
        percent: 0,
        funds: true,
        upgrade: true,
        approval: NO_APPROVAL,
      })
    ).toEqual([
      "Funding wallet running",
      "Preparing buffer waiting",
      "Writing program, 0% waiting",
      "Upgrading waiting",
    ]);
  });

  it("names the connected wallet's approval on the running step", () => {
    expect(
      at({
        step: "deploy",
        percent: 100,
        funds: false,
        upgrade: false,
        approval: { wallet: "Phantom", n: 2 },
      })
    ).toEqual([
      "Preparing buffer done",
      "Writing program, 100% done",
      "Deploying · Approve in Phantom (2 of 2) running",
    ]);
  });

  it("names the close of a buffer the connected wallet holds", () => {
    expect(
      at({
        step: "deploy",
        percent: 100,
        funds: false,
        upgrade: false,
        approval: { wallet: "Phantom", n: "close" },
      })
    ).toContain("Deploying · Approve in Phantom to close the buffer running");
  });
});
