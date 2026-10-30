// The "Not enough SOL" card for each reason a run could not fund its wallet.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";
import BaseNotEnoughSol, { WEB_FAUCET_URL } from "./BaseNotEnoughSol";
import type { BaseNotEnoughSolProps } from "./BaseNotEnoughSol";

const ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

const renderCard = (props: Partial<BaseNotEnoughSolProps>) => {
  const onRetry = vi.fn();
  const onSignIn = vi.fn();
  render(
    <TooltipProvider>
      <BaseNotEnoughSol
        cluster={props.cluster ?? "devnet"}
        reason={props.reason ?? "airdrop_failed"}
        balance={props.balance ?? 0}
        needed={props.needed ?? 1_420_000_000}
        address={ADDRESS}
        cause={props.cause ?? null}
        onRetry={onRetry}
        onSignIn={onSignIn}
      />
    </TooltipProvider>
  );
  return {
    onRetry,
    onSignIn,
    card: screen.getByRole("alert", { name: "Not enough SOL" }),
  };
};

describe("BaseNotEnoughSol", () => {
  it("names the network, the amounts, the address and the faucet's answer", () => {
    const { card, onRetry } = renderCard({ cause: "429 Too Many Requests" });

    expect(card.textContent).toContain("Not enough devnet SOL");
    expect(card.textContent).toContain("needs 1.42 SOL");
    expect(card.textContent).toContain("has 0.00 SOL");
    expect(card.textContent).toContain("7xKX…gAsU");
    expect(card.textContent).toContain("429 Too Many Requests");
    expect(
      screen.getByRole("link", { name: "Open faucet" }).getAttribute("href")
    ).toBe(WEB_FAUCET_URL);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("offers sign-in in place of Try again when signed out", () => {
    const { onSignIn } = renderCard({ reason: "signed_out" });

    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with GitHub" })
    );
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it("offers no web faucet on a network it does not serve", () => {
    renderCard({ cluster: "mainnet-beta", reason: "no_faucet" });

    expect(screen.getByText("Not enough mainnet SOL")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open faucet" })).toBeNull();
  });
});
