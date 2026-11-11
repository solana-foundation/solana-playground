// The wallet menu's "faucet is at its limit" toast, and its way to the Fund dialog
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const OTHER = "4Zr8aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789Mn3Q";
const HREF = `https://faucet.solana.com/?walletAddress=${WALLET}`;

const utils = vi.hoisted(() => ({
  PgWallet: {
    current: undefined as unknown,
    accounts: [] as unknown[],
    create: vi.fn(),
  },
}));
vi.mock("@/utils", () => utils);

import { onDidRequestFundDialog } from "../model/open";
import FaucetRefusedToast from "./FaucetRefusedToast";

utils.PgWallet.current = {
  isPg: true,
  name: "Wallet 1",
  publicKey: { toBase58: () => WALLET },
};

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

const fundButton = () =>
  screen.queryByRole("button", { name: "Send from your wallet" });

describe("features/fund-wallet/ui/FaucetRefusedToast", () => {
  it("offers Send from your wallet under the web faucet's link", () => {
    const asked: string[] = [];
    stop = onDidRequestFundDialog((from) => asked.push(from));
    const { container } = render(
      <FaucetRefusedToast href={HREF} address={WALLET} refusal="limit" />
    );

    const labels = Array.from(container.querySelectorAll("a, button")).map(
      (el) => el.textContent
    );
    expect(labels).toEqual(["Open the web faucet", "Send from your wallet"]);
    fireEvent.click(fundButton() as HTMLElement);
    expect(asked).toEqual(["faucet-toast"]);
  });

  it("leaves it out when the dialog would fund another wallet", () => {
    stop = onDidRequestFundDialog(() => undefined);
    render(<FaucetRefusedToast href={HREF} address={OTHER} refusal="limit" />);

    expect(fundButton()).toBeNull();
  });

  it("says the faucet is at its limit, or that it did not send SOL", () => {
    const { unmount } = render(
      <FaucetRefusedToast href={HREF} address={WALLET} refusal="limit" />
    );
    expect(screen.getByText("The faucet is at its limit.")).toBeTruthy();
    unmount();
    render(<FaucetRefusedToast href={HREF} address={WALLET} refusal="other" />);
    expect(screen.getByText("The faucet did not send SOL.")).toBeTruthy();
  });
});
