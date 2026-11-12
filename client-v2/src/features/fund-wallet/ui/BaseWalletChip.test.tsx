// What the wallet chip and its popover draw for each airdrop state, from props alone.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";

import type { BaseWalletChipProps } from "./BaseWalletChip";
import BaseWalletChip from "./BaseWalletChip";

const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const STEPS = ["Step one", "Step two", "Step three"];

/** The chip with every prop named, each test overriding what it is about */
const renderChip = (props: Partial<BaseWalletChipProps>) =>
  render(
    <TooltipProvider>
      <BaseWalletChip
        address={WALLET}
        balance={"balance" in props ? props.balance : 0}
        cluster={"cluster" in props ? props.cluster : "devnet"}
        hasFaucet={props.hasFaucet ?? true}
        airdropSol={5}
        faucetHref="https://faucet.solana.com/?cluster=devnet"
        faucetSteps={STEPS}
        state={props.state ?? "idle"}
        refusal={props.refusal ?? "limit"}
        received={props.received}
        shouldSignInFirst={props.shouldSignInFirst ?? false}
        onAirdrop={props.onAirdrop ?? vi.fn()}
        onOpenFaucet={props.onOpenFaucet ?? vi.fn()}
        onFund={props.onFund ?? vi.fn()}
        owner={props.owner}
        wallets={props.wallets}
        connect={props.connect}
        onConnectOpen={props.onConnectOpen ?? vi.fn()}
        onConnect={props.onConnect}
        onDisconnect={props.onDisconnect}
      />
    </TooltipProvider>
  );

/** Opens the popover from the chip */
const open = () =>
  fireEvent.click(screen.getByRole("button", { name: /^Wallet 7xKX…gAsU/ }));

describe("features/fund-wallet/ui/BaseWalletChip", () => {
  it("names the wallet, its network and its balance on the chip", () => {
    renderChip({ balance: 1.5 });
    expect(
      screen.getByRole("button", {
        name: "Wallet 7xKX…gAsU on Devnet, 1.5 SOL",
      })
    ).toBeTruthy();
  });

  it("offers the faucet and the user's own wallet, and says a sign-in comes first", () => {
    const onAirdrop = vi.fn();
    const onFund = vi.fn();
    renderChip({ shouldSignInFirst: true, onAirdrop, onFund });
    open();
    expect(screen.getByText("Playground wallet")).toBeTruthy();
    expect(screen.getByText("Devnet")).toBeTruthy();
    expect(screen.getByText("7xKXtg…osgAsU")).toBeTruthy();
    expect(
      screen.getByText("Asks you to sign in with GitHub first")
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Get 5 devnet SOL" }));
    expect(onAirdrop).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: "Send from your wallet" })
    );
    expect(onFund).toHaveBeenCalledOnce();
  });

  it("holds Get SOL off while the faucet is asked", () => {
    renderChip({ state: "asking" });
    open();
    const asking = screen.getByRole("button", { name: /Asking the faucet/ });
    expect((asking as HTMLButtonElement).disabled).toBe(true);
  });

  it("spells out the web faucet once the faucet refused, with Try again beside the user's wallet", () => {
    const onAirdrop = vi.fn();
    const onOpenFaucet = vi.fn();
    renderChip({ state: "refused", onAirdrop, onOpenFaucet });
    open();
    expect(screen.getByText("The faucet is at its limit")).toBeTruthy();
    const steps = screen.getByRole("list", {
      name: "Get SOL from the web faucet",
    });
    expect(
      Array.from(steps.querySelectorAll("li"), (li) => li.textContent)
    ).toStrictEqual(["1Step one", "2Step two", "3Step three"]);
    const faucet = screen.getByRole("link", { name: /Open the web faucet/ });
    expect(faucet.getAttribute("href")).toBe(
      "https://faucet.solana.com/?cluster=devnet"
    );
    expect(faucet.getAttribute("target")).toBe("_blank");
    fireEvent.click(faucet);
    expect(onOpenFaucet).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onAirdrop).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Use your wallet" })
    ).toBeTruthy();
  });

  it("names a refusal that is not the limit, with the same steps", () => {
    renderChip({ state: "refused", refusal: "other" });
    open();
    expect(screen.getByText("The faucet did not send SOL")).toBeTruthy();
    expect(screen.queryByText("The faucet is at its limit")).toBeNull();
    expect(
      screen.getByRole("list", { name: "Get SOL from the web faucet" })
    ).toBeTruthy();
  });

  it("waits for the balance while the web faucet is open", () => {
    renderChip({ state: "away" });
    open();
    expect(
      screen.getByText("Waiting for SOL from the web faucet…")
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open it again" })).toBeTruthy();
  });

  it("says what came, and offers nothing more", () => {
    renderChip({ state: "received", balance: 5, received: 5 });
    open();
    expect(screen.getByRole("status").textContent).toBe(
      "Got 5 SOL. You're ready to deploy"
    );
    expect(screen.queryByRole("button", { name: /Get 5/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /your wallet/ })).toBeNull();
  });

  it("offers no faucet on a network without one, and tags mainnet", () => {
    renderChip({ cluster: "mainnet-beta", hasFaucet: false, balance: 2 });
    open();
    expect(screen.getByText("Mainnet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Get / })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Send from your wallet" })
    ).toBeTruthy();
  });

  describe("connecting a wallet", () => {
    const ICON = "data:image/svg+xml,<svg/>";
    const PHANTOM = { name: "Phantom", icon: ICON };

    it("offers Connect a wallet beside the Playground wallet", () => {
      const onConnectOpen = vi.fn();
      renderChip({ onConnectOpen, onConnect: vi.fn() });
      open();
      fireEvent.click(screen.getByRole("button", { name: "Connect a wallet" }));
      expect(onConnectOpen).toHaveBeenCalledOnce();
    });

    it("lists the installed wallets under its heading, and connects the one picked", () => {
      const onConnect = vi.fn();
      renderChip({
        wallets: [PHANTOM, { name: "Solflare", icon: ICON }],
        connect: { kind: "listing" },
        onConnect,
      });
      open();
      expect(screen.getByText("Connect a wallet")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Phantom" }));
      expect(onConnect).toHaveBeenCalledWith("Phantom");
      expect(screen.getByRole("button", { name: "Solflare" })).toBeTruthy();
    });

    it("says no extension was found, with the Playground wallet as the way on", () => {
      renderChip({
        wallets: [],
        connect: { kind: "listing" },
        onConnect: vi.fn(),
      });
      open();
      expect(
        screen.getByText("No wallet extension found in this browser.")
      ).toBeTruthy();
      expect(
        screen.getByText(
          "Install Phantom, Backpack or Solflare, then reload. Or keep using the Playground wallet."
        )
      ).toBeTruthy();
    });

    it("waits for the extension, with no list to press meanwhile", () => {
      renderChip({
        wallets: [PHANTOM],
        connect: { kind: "waiting", wallet: "Phantom" },
        onConnect: vi.fn(),
      });
      open();
      expect(screen.getByText("Waiting for Phantom…")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Phantom" })).toBeNull();
    });

    it("says a declined connect kept the Playground wallet, and tries again", () => {
      const onConnect = vi.fn();
      renderChip({
        wallets: [PHANTOM],
        connect: { kind: "declined", wallet: "Phantom" },
        onConnect,
      });
      open();
      expect(
        screen.getByText(
          "Phantom didn't connect. The Playground wallet is in use."
        )
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(onConnect).toHaveBeenCalledWith("Phantom");
    });

    it("names why a connect failed when it was not the user's no", () => {
      renderChip({
        wallets: [PHANTOM],
        connect: {
          kind: "failed",
          wallet: "Phantom",
          reason: "Phantom is not installed in this browser.",
        },
        onConnect: vi.fn(),
      });
      open();
      expect(
        screen.getByText(
          "Phantom didn't connect: Phantom is not installed in this browser. The Playground wallet is in use."
        )
      ).toBeTruthy();
    });

    it("names a connected wallet, offers to disconnect it, and drops Send from your wallet", () => {
      const onDisconnect = vi.fn();
      renderChip({ owner: PHANTOM, onConnect: vi.fn(), onDisconnect });
      open();
      expect(screen.getByText("Phantom")).toBeTruthy();
      expect(screen.queryByText("Playground wallet")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Send from your wallet" })
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Connect a wallet" })
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Disconnect Phantom" })
      );
      expect(onDisconnect).toHaveBeenCalledOnce();
    });
  });
});
