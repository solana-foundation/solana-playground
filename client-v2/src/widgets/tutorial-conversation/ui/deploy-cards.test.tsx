/* eslint-disable layers/curry-order, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import type { RunResult } from "@/features/tutorial-conversation";
import { TooltipProvider } from "@/shared/ui/tooltip";

import type { DeployResult } from "./BaseDeployResultCard";
import BaseDeployResultCard from "./BaseDeployResultCard";

const PROGRAM = "HeLLo1111111111111111111111111111111111Anch";
const SIGNATURE =
  "5igSignature111111111111111111111111111111111111111111111Xyz9";
const WALLET = "WaLLet11111111111111111111111111111111111Qa";

const landed = (
  upgraded: boolean,
  lamports: number | null
): Extract<RunResult, { ok: true; act: "deploy" | "buildDeploy" }> => ({
  act: "deploy",
  ok: true,
  seconds: 9,
  programId: PROGRAM,
  signature: SIGNATURE,
  upgraded,
  lamports,
  instructions: ["hello"],
});

const noFunds: DeployResult = {
  act: "deploy",
  ok: false,
  seconds: 2,
  reason: "no_funds",
  message: "airdrop refused",
  balance: 120_000_000,
  cost: 1_820_000_000,
  address: WALLET,
};

const card = (
  result: DeployResult,
  over: Partial<{
    open: boolean;
    onShowLog: () => void;
    onCreateWallet: () => void;
  }> = {}
) =>
  render(
    <TooltipProvider>
      <BaseDeployResultCard
        result={result}
        open={over.open ?? true}
        onShowLog={over.onShowLog ?? vi.fn()}
        onCreateWallet={over.onCreateWallet ?? vi.fn()}
      />
    </TooltipProvider>
  );

describe("BaseDeployResultCard", () => {
  it("is one row, Deployed to devnet, with what it did behind its chevron", async () => {
    const onShowLog = vi.fn();
    const { container } = card(landed(false, 1_250_000_000), { onShowLog });
    expect(screen.getByText("Deployed to devnet")).toBeTruthy();
    expect(screen.queryByText(/test SOL/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(container.textContent).toContain(
      "Your program now lives on devnet at HeLLo1…11Anch. The deploy took 9 s and 1.25 test SOL from your wallet."
    );
    expect(screen.getByRole("button", { name: "Copy id" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /^Log/ }));
    expect(onShowLog).toHaveBeenCalled();
  });

  it("copies the whole program id from a labelled Copy id, and keeps the short id on one line", async () => {
    const writeText = vi.fn(async () => {});
    const before = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    onTestFinished(() => {
      if (before) Object.defineProperty(navigator, "clipboard", before);
      else Reflect.deleteProperty(navigator, "clipboard");
    });
    const { container } = card(landed(false, 1_250_000_000));
    await userEvent.click(screen.getByRole("button", { name: /Details/ }));
    const copy = screen.getByRole("button", { name: "Copy id" });
    expect(copy.textContent).toContain("Copy id");
    await userEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith(PROGRAM);
    expect(
      container.querySelector("p code")?.closest("p")?.className
    ).toContain("[&_code]:whitespace-nowrap");
  });

  it("links the program and the deploy's transaction to devnet Explorer, in a new tab", async () => {
    card(landed(false, 1_250_000_000));
    await userEvent.click(screen.getByRole("button", { name: /Details/ }));
    const program = screen.getByRole("link", { name: /Explorer/ });
    expect(program.getAttribute("href")).toBe(
      `https://explorer.solana.com/address/${PROGRAM}?cluster=devnet`
    );
    expect(program.getAttribute("target")).toBe("_blank");
    const tx = screen.getByRole("link", { name: /Transaction/ });
    expect(tx.getAttribute("href")).toBe(
      `https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet`
    );
  });

  it("reads Upgraded with the short id, and says no cost when recognised after a reload", async () => {
    const { container } = card(landed(true, null));
    expect(screen.getByText("Upgraded HeLLo1…11Anch")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(container.textContent).toContain(
      "Your program at HeLLo1…11Anch now runs the new code. The upgrade took 9 s."
    );
  });

  it("says the build and deploy took it, for a build-and-deploy", async () => {
    const { container } = card({
      act: "buildDeploy",
      ok: true,
      seconds: 12,
      programId: PROGRAM,
      signature: SIGNATURE,
      upgraded: false,
      lamports: 2_000_000_000,
      instructions: ["hello"],
    });
    await userEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(container.textContent).toContain(
      "The build and deploy took 12 s and 2 test SOL from your wallet."
    );
  });

  it("says how short the wallet is, with its whole address, Copy beside it and Open faucet; the retry is the act card under it", () => {
    card(noFunds);
    expect(screen.getByText("Not enough devnet SOL")).toBeTruthy();
    expect(
      screen.getByText(
        "Your wallet has 0.12 SOL, and this deploy needs about 1.82 SOL. Get devnet SOL from the faucet, or top the wallet up yourself."
      )
    ).toBeTruthy();
    expect(screen.getByText("Your wallet")).toBeTruthy();
    // The whole address, with Copy right after it rather than at the row's end
    const copy = screen.getByRole("button", {
      name: "Copy the wallet address",
    });
    expect(copy.parentElement?.parentElement?.textContent).toBe(WALLET);
    const faucet = screen.getByRole("link", { name: /Open faucet/ });
    expect(faucet.getAttribute("href")).toBe(
      `https://faucet.solana.com/?walletAddress=${WALLET}&amount=5&cluster=devnet`
    );
    expect(faucet.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
  });

  it("tells an airdrop the faucet refused that the faucet is at its limit", () => {
    card({
      act: "airdrop",
      ok: false,
      seconds: 2,
      reason: "no_funds",
      message: "429 Too Many Requests",
      balance: 120_000_000,
      cost: 1_820_000_000,
      address: WALLET,
    });
    expect(
      screen.getByText(
        "Your wallet has 0.12 SOL, and this deploy needs about 1.82 SOL. The devnet faucet is at its limit for now: try again in a minute, or top the wallet up yourself."
      )
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open faucet/ })).toBeTruthy();
  });

  it("tells an airdrop that failed otherwise that it didn't go through", () => {
    card({
      act: "airdrop",
      ok: false,
      seconds: 2,
      reason: "no_funds",
      message: "The airdrop did not reach the wallet",
      balance: 0,
      cost: 2_806_300_000,
      address: WALLET,
    });
    expect(
      screen.getByText(
        "Your wallet has 0 SOL, and this deploy needs about 2.81 SOL. The airdrop didn't go through: try again in a minute, or top the wallet up yourself."
      )
    ).toBeTruthy();
  });

  it("reads the faucet's own limit message as a rate limit", () => {
    card({
      act: "airdrop",
      ok: false,
      seconds: 2,
      reason: "no_funds",
      message:
        "airdrop request failed. This can happen when the rate limit is reached.",
      balance: 123_456_789,
      cost: 2_806_300_000,
      address: WALLET,
    });
    expect(
      screen.getByText(
        "Your wallet has 0.1235 SOL, and this deploy needs about 2.81 SOL. The devnet faucet is at its limit for now: try again in a minute, or top the wallet up yourself."
      )
    ).toBeTruthy();
  });

  it("offers to create the wallet when there is none", async () => {
    const onCreateWallet = vi.fn();
    card(
      {
        act: "deploy",
        ok: false,
        seconds: 0,
        reason: "no_wallet",
        message: "No wallet",
      },
      { onCreateWallet }
    );
    expect(screen.getByText("No wallet")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: /Create wallet/ })
    );
    expect(onCreateWallet).toHaveBeenCalled();
  });

  it("says why a deploy failed; its Try again is the act card under it", () => {
    card({
      act: "buildDeploy",
      ok: false,
      seconds: 4,
      reason: "failed",
      message: "Blockhash expired",
    });
    expect(screen.getByText("Deploy failed")).toBeTruthy();
    expect(screen.getByText("Blockhash expired")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
  });

  it("folds a failure to its head, with no button, once it is a record", () => {
    card(noFunds, { open: false });
    expect(screen.getByText("Not enough devnet SOL")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
