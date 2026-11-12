// The "Not enough SOL" card for each reason a run could not fund its wallet.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";

import type { BaseNotEnoughSolProps } from "./BaseNotEnoughSol";
import BaseNotEnoughSol from "./BaseNotEnoughSol";

const ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

const renderCard = (props: Partial<BaseNotEnoughSolProps>) => {
  const onRetry = vi.fn();
  const onAirdrop = vi.fn();
  const onSignIn = vi.fn();
  render(
    <TooltipProvider>
      <BaseNotEnoughSol
        cluster={"cluster" in props ? props.cluster : "devnet"}
        reason={props.reason ?? "airdrop_failed"}
        balance={props.balance ?? 0}
        needed={props.needed ?? 1_420_000_000}
        address={ADDRESS}
        // eslint-disable-next-line unicorn/no-null -- the prop's none value
        cause={props.cause ?? null}
        onRetry={onRetry}
        onAirdrop={onAirdrop}
        onSignIn={onSignIn}
      />
    </TooltipProvider>
  );
  return {
    onRetry,
    onAirdrop,
    onSignIn,
    card: screen.getByRole("alert", { name: "Not enough SOL" }),
  };
};

describe("BaseNotEnoughSol", () => {
  it("names the network, the amounts, the address and the faucet's answer", () => {
    const { card } = renderCard({ cause: "429 Too Many Requests" });

    expect(card.textContent).toContain("Not enough devnet SOL");
    expect(card.textContent).toContain(
      "Your wallet has 0.00 SOL, this deploy needs about 1.42 SOL."
    );
    expect(card.textContent).toContain("7xKX…gAsU");
    expect(card.textContent).toContain("429 Too Many Requests");
    expect(
      screen.getByRole("link", { name: "Open faucet" }).getAttribute("href")
    ).toBe(
      `https://faucet.solana.com/?walletAddress=${ADDRESS}&cluster=devnet`
    );
  });

  it("offers Request airdrop in place of Try again while automatic airdrop is off", () => {
    const { onAirdrop, onRetry } = renderCard({ reason: "airdrop_off" });

    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(
      screen.getByText(
        "Request devnet SOL from the faucet, or send SOL to the wallet below."
      )
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Request airdrop" }));
    expect(onAirdrop).toHaveBeenCalledOnce();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("deploys again without an airdrop on Try again where there is no faucet", () => {
    const { onAirdrop, onRetry } = renderCard({ reason: "no_faucet" });

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onAirdrop).not.toHaveBeenCalled();
  });

  it("offers sign-in in place of Try again when signed out", () => {
    const { onSignIn } = renderCard({ reason: "signed_out" });

    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(
      screen.getByText("Sign in with GitHub to request devnet SOL.")
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it("offers no web faucet on a network it does not serve", () => {
    renderCard({ cluster: "mainnet-beta", reason: "no_faucet" });

    expect(screen.getByText("Not enough mainnet SOL")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open faucet" })).toBeNull();
  });

  it("names no network while the cluster is unknown", () => {
    renderCard({ cluster: undefined, reason: "signed_out" });

    expect(screen.getByText("Not enough SOL")).toBeTruthy();
    expect(
      screen.getByText("Sign in with GitHub to request SOL.")
    ).toBeTruthy();
  });
});
