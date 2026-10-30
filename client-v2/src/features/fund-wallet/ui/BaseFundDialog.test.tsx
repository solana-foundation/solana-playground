// What the Fund dialog draws for each state its spec names, from props alone.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BaseFundDialog from "./BaseFundDialog";
import type { BaseFundDialogProps, FundPayer } from "./BaseFundDialog";

const RECEIVER = {
  name: "Wallet 1",
  address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
};
const PHANTOM = { name: "Phantom", icon: "data:image/svg+xml;base64,PHN2Zy8+" };
const PAYER: FundPayer = {
  name: "Phantom",
  address: "7Hq5aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789Xk2P",
  balance: 2,
};

/** The dialog with every prop named, each test overriding what it is about */
const renderDialog = (props: Partial<BaseFundDialogProps>) =>
  render(
    <BaseFundDialog
      open={true}
      onOpenChange={props.onOpenChange ?? vi.fn()}
      receiver={props.receiver ?? RECEIVER}
      wallets={props.wallets ?? [PHANTOM]}
      payer={props.payer === undefined ? null : props.payer}
      cluster={props.cluster === undefined ? "devnet" : props.cluster}
      amount={props.amount ?? "1"}
      onAmountChange={props.onAmountChange ?? vi.fn()}
      onConnect={props.onConnect ?? vi.fn().mockResolvedValue(undefined)}
      onSend={props.onSend ?? vi.fn().mockResolvedValue(undefined)}
      failure={props.failure === undefined ? null : props.failure}
    />
  );

const sendButton = () => screen.getByRole("button", { name: /^Send/ });

describe("features/fund-wallet/ui/BaseFundDialog", () => {
  it("names the receiving account and its short address", () => {
    renderDialog({});

    expect(
      screen.getByRole("heading", { name: "Fund your Playground wallet" })
    ).toBeTruthy();
    expect(screen.getByText("Wallet 1")).toBeTruthy();
    expect(screen.getByText("9xQe…VFin")).toBeTruthy();
  });

  it("lists each detected wallet as a Connect button", () => {
    const onConnect = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onConnect });

    fireEvent.click(screen.getByRole("button", { name: "Connect Phantom" }));

    expect(onConnect).toHaveBeenCalledWith("Phantom");
  });

  it("says it waits for the wallet while connecting", () => {
    renderDialog({ onConnect: () => new Promise<void>(() => {}) });

    fireEvent.click(screen.getByRole("button", { name: "Connect Phantom" }));

    expect(screen.getByText("Waiting for Phantom…")).toBeTruthy();
  });

  it("says no wallet was found, and shows no amount field", () => {
    renderDialog({ wallets: [] });

    expect(
      screen.getByText("No wallet extension found in this browser.")
    ).toBeTruthy();
    expect(screen.queryByLabelText("Amount (SOL)")).toBeNull();
  });

  it("shows the connected payer's short address and balance", () => {
    renderDialog({ payer: PAYER });

    expect(screen.getByText("7Hq5…Xk2P")).toBeTruthy();
    expect(screen.getByText(/· 2 SOL$/)).toBeTruthy();
    expect(screen.getByLabelText("Amount (SOL)").id).toBe("fund-amount");
    expect(sendButton().textContent).toContain("Send 1 SOL");
    expect(sendButton().hasAttribute("disabled")).toBe(false);
  });

  it("disables send above the balance and says what the wallet holds", () => {
    renderDialog({
      payer: { name: "Phantom", address: PAYER.address, balance: 0.5 },
    });

    expect(sendButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Phantom holds 0.5 SOL.")).toBeTruthy();
  });

  it.each(["abc", "0", "-1"])(
    "disables send for %j and asks for an amount above 0",
    (amount) => {
      renderDialog({ payer: PAYER, amount });

      expect(sendButton().hasAttribute("disabled")).toBe(true);
      expect(screen.getByText("Enter an amount above 0.")).toBeTruthy();
    }
  );

  it("waits for the balance before allowing a send", () => {
    renderDialog({
      payer: { name: "Phantom", address: PAYER.address, balance: "loading" },
    });

    expect(sendButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Checking the balance…")).toBeTruthy();
  });

  it("passes typing up", () => {
    const onAmountChange = vi.fn();
    renderDialog({ payer: PAYER, onAmountChange });

    fireEvent.change(screen.getByLabelText("Amount (SOL)"), {
      target: { value: "0.25" },
    });

    expect(onAmountChange).toHaveBeenCalledWith("0.25");
  });

  it.each([
    [
      { kind: "connect-declined" as const, wallet: "Phantom" },
      "You declined in Phantom. Nothing was sent.",
    ],
    [
      { kind: "send-declined" as const, wallet: "Phantom" },
      "You declined in Phantom. Nothing was sent.",
    ],
  ])("says when %j", (failure, text) => {
    renderDialog({ payer: PAYER, failure });

    expect(screen.getByRole("alert").textContent).toContain(text);
  });

  it("says the SOL could not be sent, with the reason, and allows a retry", () => {
    renderDialog({
      payer: PAYER,
      failure: { kind: "send-failed", detail: "Blockhash not found" },
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't send the SOL."
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Blockhash not found"
    );
    expect(sendButton().hasAttribute("disabled")).toBe(false);
  });

  it("names the cluster the SOL goes to", () => {
    renderDialog({ payer: PAYER, cluster: "mainnet-beta" });

    expect(screen.getByText("Sent on mainnet-beta.")).toBeTruthy();
  });

  it("warns above Send on mainnet only", () => {
    renderDialog({ payer: PAYER, cluster: "mainnet-beta" });
    expect(screen.getByText("Mainnet uses real SOL")).toBeTruthy();

    cleanup();
    renderDialog({ payer: PAYER, cluster: "devnet" });
    expect(screen.queryByText("Mainnet uses real SOL")).toBeNull();
  });

  it("says when the balance cannot be read, and allows no send", () => {
    renderDialog({
      payer: {
        name: "Phantom",
        address: PAYER.address,
        balance: "unavailable",
      },
    });

    expect(screen.getByText(/Couldn't read Phantom's balance/)).toBeTruthy();
    expect(sendButton().hasAttribute("disabled")).toBe(true);
  });

  it("allows no second send while a sent transfer is unconfirmed", () => {
    renderDialog({
      payer: PAYER,
      failure: { kind: "send-unconfirmed", signature: "5igNaTuRe" },
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "The SOL was sent, but not confirmed yet."
    );
    expect(screen.getByRole("alert").textContent).toContain("5igNaTuRe");
    expect(sendButton().hasAttribute("disabled")).toBe(true);
  });

  it("asks for at most 9 decimals", () => {
    renderDialog({ payer: PAYER, amount: "0.0000000001" });

    expect(screen.getByText("Use at most 9 decimals.")).toBeTruthy();
  });
});
