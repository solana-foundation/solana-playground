// The connected Fund dialog: who receives, connecting a payer without changing
// the current wallet, sending, and what each outcome reports.
import type { ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

const RECEIVER_ADDRESS = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const PAYER_ADDRESS = "7Hq5aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789Xk2P";

/** A bridged wallet as `PgWallet.standardWallets` holds it */
const makeWallet = (name: string) => {
  const wallet = {
    name,
    icon: "data:image/svg+xml;base64,PHN2Zy8+",
    connected: false,
    publicKey: null as null | { toBase58: () => string },
    connect: vi.fn(async () => {
      wallet.connected = true;
      wallet.publicKey = { toBase58: () => PAYER_ADDRESS };
    }),
  };
  return wallet;
};

const utils = vi.hoisted(() => ({
  PgWallet: {
    standardWallets: [] as unknown[],
    current: null as unknown,
    accounts: [{ name: "Wallet 1", kp: [] }],
    state: "pg",
    create: () => ({ publicKey: { toBase58: () => RECEIVER_ADDRESS } }),
    onDidChangeStandardWallets: () => ({ dispose: () => undefined }),
    onDidChangeCurrent: () => ({ dispose: () => undefined }),
  },
  PgConnection: {
    cluster: "devnet" as string | null,
    onDidChangeCluster: () => ({ dispose: () => undefined }),
    current: { getBalance: vi.fn() },
  },
  PgView: { setToast: vi.fn() },
  PgWeb3: {
    PublicKey: class {
      constructor(readonly value: string) {}
    },
    lamportsToSol: (lamports: number) => lamports / 1e9,
  },
}));
vi.mock("@/utils", () => utils);
vi.mock("@/hooks", () => ({ useRenderOnChange: () => undefined }));

const transfer = vi.hoisted(() => ({ sendFunds: vi.fn() }));
vi.mock("../model/transfer", async () => {
  const real = await vi.importActual<typeof import("../model/transfer")>(
    "../model/transfer"
  );
  return {
    sendFunds: transfer.sendFunds,
    TransferNotConfirmedError: real.TransferNotConfirmedError,
  };
});

import FundDialog from "./FundDialog";

let sent: ReturnType<typeof memoryProvider>;
let phantom: ReturnType<typeof makeWallet>;
beforeEach(() => {
  phantom = makeWallet("Phantom");
  utils.PgWallet.standardWallets = [phantom];
  utils.PgWallet.current = {
    isPg: true,
    name: "Wallet 1",
    publicKey: { toBase58: () => RECEIVER_ADDRESS },
  };
  utils.PgWallet.state = "pg";
  utils.PgConnection.cluster = "devnet";
  utils.PgConnection.current.getBalance.mockReset().mockResolvedValue(2e9);
  utils.PgView.setToast.mockReset();
  transfer.sendFunds.mockReset().mockResolvedValue("sig");
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});
afterEach(() => {
  resetTelemetry();
});

const events = (name: string) =>
  sent.events.filter((event) => event.name === name);

const renderOpen = async (onOpenChange = vi.fn()) => {
  render(<FundDialog open={true} onOpenChange={onOpenChange} />);
  await act(async () => undefined);
  return onOpenChange;
};

const connectPhantom = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Connect Phantom" }));
  });
};

const sendButton = () => screen.getByRole("button", { name: /^Send/ });

describe("features/fund-wallet/ui/FundDialog", () => {
  it("counts the dialog opening from the account menu", async () => {
    await renderOpen();

    expect(events("fund_dialog_opened")).toEqual([
      expect.objectContaining({ params: { from: "account-menu" } }),
    ]);
  });

  it("names the first account as receiver when an extension is current", async () => {
    utils.PgWallet.current = {
      isPg: false,
      name: "Phantom",
      publicKey: { toBase58: () => PAYER_ADDRESS },
    };
    await renderOpen();

    expect(screen.getByText("Wallet 1")).toBeTruthy();
    expect(screen.getByText("9xQe…VFin")).toBeTruthy();
  });

  it("connects a payer without changing the current wallet", async () => {
    await renderOpen();

    await connectPhantom();

    expect(phantom.connect).toHaveBeenCalledOnce();
    expect(utils.PgWallet.state).toBe("pg");
    expect(screen.getByText("7Hq5…Xk2P")).toBeTruthy();
    expect(events("fund_wallet_connected")).toEqual([
      expect.objectContaining({ params: { wallet: "Phantom" } }),
    ]);
  });

  it("stays open and says so when the connection is declined", async () => {
    phantom.connect.mockRejectedValueOnce(
      new Error("User rejected the request.")
    );
    await renderOpen();

    await connectPhantom();

    expect(screen.getByRole("alert").textContent).toContain(
      "You declined in Phantom. Nothing was sent."
    );
    expect(
      screen.getByRole("button", { name: "Connect Phantom" })
    ).toBeTruthy();
    expect(events("fund_failed")).toEqual([
      expect.objectContaining({
        params: { stage: "connect", reason: "rejected" },
      }),
    ]);
  });

  it("sends, toasts, closes and counts a confirmed transfer", async () => {
    const onOpenChange = await renderOpen();
    await connectPhantom();

    await act(async () => {
      fireEvent.click(sendButton());
    });

    expect(transfer.sendFunds).toHaveBeenCalledWith(
      expect.objectContaining({ to: RECEIVER_ADDRESS, lamports: 1e9 })
    );
    const toast = utils.PgView.setToast.mock.calls[0][0] as () => ReactElement;
    render(toast());
    expect(screen.getByText("Sent 1 SOL to Wallet 1.")).toBeTruthy();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(events("fund_sent")).toEqual([
      expect.objectContaining({ params: { cluster: "devnet" } }),
    ]);
  });

  it("keeps the amount and counts a declined transfer", async () => {
    transfer.sendFunds.mockRejectedValueOnce(
      new Error("User rejected the request.")
    );
    const onOpenChange = await renderOpen();
    await connectPhantom();
    fireEvent.change(screen.getByLabelText("Amount (SOL)"), {
      target: { value: "0.5" },
    });

    await act(async () => {
      fireEvent.click(sendButton());
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "You declined in Phantom. Nothing was sent."
    );
    expect(
      (screen.getByLabelText("Amount (SOL)") as HTMLInputElement).value
    ).toBe("0.5");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(events("fund_failed")).toEqual([
      expect.objectContaining({
        params: { stage: "send", reason: "rejected" },
      }),
    ]);
  });

  it("shows a network failure with its reason and allows a retry", async () => {
    transfer.sendFunds.mockRejectedValueOnce(
      new Error("failed to send transaction: Blockhash not found")
    );
    await renderOpen();
    await connectPhantom();

    await act(async () => {
      fireEvent.click(sendButton());
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't send the SOL."
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Blockhash not found"
    );
    expect(sendButton().hasAttribute("disabled")).toBe(false);
    expect(events("fund_failed")).toEqual([
      expect.objectContaining({ params: { stage: "send", reason: "network" } }),
    ]);
  });

  it("allows no second send when the transfer was sent but not confirmed", async () => {
    const { TransferNotConfirmedError } = await vi.importActual<
      typeof import("../model/transfer")
    >("../model/transfer");
    transfer.sendFunds.mockRejectedValueOnce(
      new TransferNotConfirmedError("5igNaTuRe", new Error("timed out"))
    );
    await renderOpen();
    await connectPhantom();

    await act(async () => {
      fireEvent.click(sendButton());
    });

    expect(screen.getByRole("alert").textContent).toContain("5igNaTuRe");
    expect(sendButton().hasAttribute("disabled")).toBe(true);
    expect(events("fund_failed")).toEqual([
      expect.objectContaining({
        params: { stage: "send", reason: "unconfirmed" },
      }),
    ]);
  });

  it("says when a wallet answers without connecting", async () => {
    phantom.connect.mockImplementationOnce(async () => undefined);
    await renderOpen();

    await connectPhantom();

    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't connect the wallet."
    );
    expect(events("fund_wallet_connected")).toEqual([]);
  });

  it("says when the balance cannot be read", async () => {
    utils.PgConnection.current.getBalance.mockRejectedValueOnce(
      new Error("429")
    );
    await renderOpen();

    await connectPhantom();

    expect(screen.getByText(/Couldn't read Phantom's balance/)).toBeTruthy();
  });

  it("toasts a small amount without an exponent", async () => {
    await renderOpen();
    await connectPhantom();
    fireEvent.change(screen.getByLabelText("Amount (SOL)"), {
      target: { value: "0.0000001" },
    });

    await act(async () => {
      fireEvent.click(sendButton());
    });

    const toast = utils.PgView.setToast.mock.calls[0][0] as () => ReactElement;
    const { container } = render(toast());
    expect(container.textContent).toBe("Sent 0.0000001 SOL to Wallet 1.");
  });

  it("renders while the current extension is mid-disconnect, with no key", async () => {
    utils.PgWallet.current = { isPg: false, name: "Phantom", publicKey: null };

    render(<FundDialog open={false} onOpenChange={vi.fn()} />);
    await renderOpen();

    expect(screen.getByText("Wallet 1")).toBeTruthy();
  });
});
