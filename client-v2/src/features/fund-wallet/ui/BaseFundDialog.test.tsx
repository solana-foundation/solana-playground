// What the Fund dialog draws for each state its spec names, from props alone.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const reportButtonFailure = vi.hoisted(() => vi.fn(() => () => undefined));
vi.mock("@/shared/lib/report-button-failure", () => ({ reportButtonFailure }));

import type { BaseFundDialogProps, FundPayer } from "./BaseFundDialog";
import BaseFundDialog from "./BaseFundDialog";

const RECEIVER = {
  name: "Wallet 1",
  address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
};
const PHANTOM = { name: "Phantom", icon: "data:image/svg+xml;base64,PHN2Zy8+" };
const PAYER: FundPayer = {
  name: "Phantom",
  icon: PHANTOM.icon,
  address: "7Hq5aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789Xk2P",
  balance: 2,
};

/** The payer holding `balance`, every field named */
const payerHolding = (balance: FundPayer["balance"]): FundPayer => ({
  name: PAYER.name,
  icon: PAYER.icon,
  address: PAYER.address,
  balance,
});

/** The dialog with every prop named, each test overriding what it is about */
const renderDialog = (props: Partial<BaseFundDialogProps>) =>
  render(
    <BaseFundDialog
      open={true}
      onOpenChange={props.onOpenChange ?? vi.fn()}
      receiver={props.receiver ?? RECEIVER}
      wallets={props.wallets ?? [PHANTOM]}
      payer={props.payer}
      cluster={props.cluster === undefined ? "devnet" : props.cluster}
      amount={props.amount ?? "1"}
      onAmountChange={props.onAmountChange ?? vi.fn()}
      onConnect={props.onConnect ?? vi.fn().mockResolvedValue(undefined)}
      onSend={props.onSend ?? vi.fn().mockResolvedValue(undefined)}
      failure={props.failure}
      addressUrl={props.addressUrl}
      isPhone={props.isPhone}
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

  it("links both short addresses to the explorer, in a new tab", () => {
    renderDialog({
      payer: PAYER,
      addressUrl: (address) => `https://explorer.test/address/${address}`,
    });

    const receiver = screen.getByRole("link", { name: "9xQe…VFin" });
    expect(receiver.getAttribute("href")).toBe(
      `https://explorer.test/address/${RECEIVER.address}`
    );
    expect(receiver.getAttribute("target")).toBe("_blank");
    expect(receiver.getAttribute("rel")).toBe("noopener noreferrer");
    expect(
      screen.getByRole("link", { name: "7Hq5…Xk2P" }).getAttribute("href")
    ).toBe(`https://explorer.test/address/${PAYER.address}`);
  });

  it("shows the addresses as text where the explorer cannot open the cluster", () => {
    renderDialog({ payer: PAYER, addressUrl: () => undefined });

    expect(screen.queryByRole("link")).toBeNull();
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

    // By role and name: the busy label is in the DOM, hidden, before the click
    const busy = screen.getByRole("button", { name: "Waiting for Phantom…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
  });

  it("says no wallet was found, and shows no amount field", () => {
    renderDialog({ wallets: [] });

    expect(
      screen.getByText("No wallet extension found in this browser.")
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Install Phantom, Backpack or Solflare, then reload. Or keep using the Playground wallet."
      )
    ).toBeTruthy();
    expect(screen.queryByLabelText("Amount (SOL)")).toBeNull();
  });

  it("shows the connected payer as a badge, then its short address and balance", () => {
    renderDialog({ payer: PAYER });

    const badge = screen.getByText("Phantom", {
      selector: '[data-slot="badge"]',
    });
    expect(badge.querySelector("img")?.getAttribute("src")).toBe(PHANTOM.icon);
    expect(screen.getByText("7Hq5…Xk2P")).toBeTruthy();
    expect(screen.getByText(/· 2 SOL$/)).toBeTruthy();
    expect(screen.getByLabelText("Amount (SOL)").id).toBe("fund-amount");
    expect(sendButton().textContent).toContain("Send 1 SOL");
    expect(sendButton().hasAttribute("disabled")).toBe(false);
  });

  it("disables send above the balance and says what the wallet holds", () => {
    renderDialog({
      payer: payerHolding(0.5),
    });

    expect(sendButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Phantom holds 0.5 SOL.")).toBeTruthy();
  });

  it.each(["abc", "-1"])(
    "disables send for %j and asks for an amount above 0",
    (amount) => {
      renderDialog({ payer: PAYER, amount });

      expect(sendButton().hasAttribute("disabled")).toBe(true);
      expect(screen.getByText("Enter an amount above 0.")).toBeTruthy();
      expect(
        screen.getByLabelText("Amount (SOL)").getAttribute("aria-invalid")
      ).toBe("true");
    }
  );

  it("asks for an amount above 0 at 0 as a hint, not an error", () => {
    renderDialog({ payer: PAYER, amount: "0" });

    expect(sendButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Enter an amount above 0.")).toBeTruthy();
    expect(
      screen.getByLabelText("Amount (SOL)").hasAttribute("aria-invalid")
    ).toBe(false);
  });

  it.each([
    { name: "More by 0.1 SOL", amount: "0.2", next: "0.3" },
    { name: "Less by 0.1 SOL", amount: "0.2", next: "0.1" },
  ])("$name steps the amount", ({ name, amount, next }) => {
    const onAmountChange = vi.fn();
    renderDialog({ payer: PAYER, amount, onAmountChange });

    fireEvent.click(screen.getByRole("button", { name }));

    expect(onAmountChange).toHaveBeenCalledWith(next);
  });

  it.each([
    { key: "ArrowUp", amount: "1.999", next: "2" },
    { key: "ArrowDown", amount: "1.999", next: "1.9" },
  ])("$key steps the amount by 0.1", ({ key, amount, next }) => {
    const onAmountChange = vi.fn();
    renderDialog({ payer: PAYER, amount, onAmountChange });

    fireEvent.keyDown(screen.getByLabelText("Amount (SOL)"), { key });

    expect(onAmountChange).toHaveBeenCalledWith(next);
  });

  it("leaves an arrow key with a modifier alone", () => {
    const onAmountChange = vi.fn();
    renderDialog({ payer: PAYER, amount: "1", onAmountChange });

    fireEvent.keyDown(screen.getByLabelText("Amount (SOL)"), {
      key: "ArrowUp",
      shiftKey: true,
    });

    expect(onAmountChange).not.toHaveBeenCalled();
  });

  it("disables Less at 0", () => {
    renderDialog({ payer: PAYER, amount: "0" });

    expect(
      (
        screen.getByRole("button", {
          name: "Less by 0.1 SOL",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("waits for the balance before allowing a send", () => {
    renderDialog({
      payer: payerHolding("loading"),
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

    expect(screen.getByRole("alert").textContent).toContain("Could not send.");
    expect(screen.getByRole("alert").textContent).toContain(
      "Blockhash not found"
    );
    expect(sendButton().hasAttribute("disabled")).toBe(false);
  });

  it("allows Send again after a send that failed, and reports the failure", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("boom"));
    renderDialog({ payer: PAYER, onSend });

    await act(async () => {
      fireEvent.click(sendButton());
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(sendButton().hasAttribute("disabled")).toBe(false);
    expect(sendButton().hasAttribute("aria-busy")).toBe(false);
    expect(reportButtonFailure).toHaveBeenCalledWith("send the SOL");
  });

  it("draws the phone's foot: no Cancel, Send across it", () => {
    renderDialog({ payer: PAYER, isPhone: true });

    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(sendButton().getAttribute("data-variant")).toBe("accent");
  });

  it("draws no foot on a phone before a payer connects", () => {
    renderDialog({ isPhone: true });

    expect(document.querySelector('[data-slot="dialog-footer"]')).toBeNull();
  });

  it("says where the SOL arrives", () => {
    renderDialog({ payer: PAYER, cluster: "mainnet-beta" });

    expect(screen.getByText("Arrives in Wallet 1 on mainnet.")).toBeTruthy();
  });

  it("makes Send the brand call to action, with a spinner while it waits", () => {
    renderDialog({ payer: PAYER, onSend: () => new Promise<void>(() => {}) });

    expect(sendButton().getAttribute("data-slot")).toBe("brand-button");
    fireEvent.click(sendButton());

    expect(sendButton().hasAttribute("disabled")).toBe(true);
    expect(sendButton().getAttribute("aria-busy")).toBe("true");
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
      payer: payerHolding("unavailable"),
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
      "Sent, not confirmed yet."
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Check it in Explorer before you send again."
    );
    expect(screen.getByRole("alert").textContent).toContain("5igNaTuRe");
    expect(sendButton().hasAttribute("disabled")).toBe(true);
  });

  it("asks for at most 9 decimals", () => {
    renderDialog({ payer: PAYER, amount: "0.0000000001" });

    expect(screen.getByText("Use at most 9 decimals.")).toBeTruthy();
  });

  it("fills the balance less the fee when Max is pressed", () => {
    const onAmountChange = vi.fn();
    renderDialog({ payer: PAYER, onAmountChange });

    fireEvent.click(screen.getByRole("button", { name: "Max" }));

    expect(onAmountChange).toHaveBeenCalledWith("1.999");
  });

  it.each<FundPayer["balance"]>([0.0005, "loading", "unavailable"])(
    "disables Max while the balance is %j",
    (balance) => {
      renderDialog({
        payer: payerHolding(balance),
      });

      expect(
        (screen.getByRole("button", { name: "Max" }) as HTMLButtonElement)
          .disabled
      ).toBe(true);
    }
  );
});
