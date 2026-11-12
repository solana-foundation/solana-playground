// The connected Fund dialog: who receives, connecting a payer without changing
// the current wallet, sending, and what each outcome reports.
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

const RECEIVER_ADDRESS = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const PAYER_ADDRESS = "7Hq5aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789Xk2P";
const OTHER_ADDRESS = "4Zr8aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789Mn3Q";

/** A bridged wallet as `PgWallet.standardWallets` holds it */
const makeWallet = (name: string) => {
  const listeners = new Map<string, Set<() => void>>();
  const wallet = {
    name,
    icon: "data:image/svg+xml;base64,PHN2Zy8+",
    connected: false,
    // eslint-disable-next-line unicorn/no-null -- a wallet's `publicKey` is `null` until it connects
    publicKey: null as null | { toBase58: () => string },
    connect: vi.fn(async () => {
      wallet.connected = true;
      wallet.publicKey = { toBase58: () => PAYER_ADDRESS };
    }),
    on: vi.fn((event: string, fn: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(fn);
    }),
    off: vi.fn((event: string, fn: () => void) => {
      listeners.get(event)?.delete(fn);
    }),
    emit: (event: string) => listeners.get(event)?.forEach((fn) => fn()),
  };
  return wallet;
};

const utils = vi.hoisted(() => ({
  PgWallet: {
    standardWallets: [] as unknown[],
    current: undefined as unknown,
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
  PgBlockExplorer: {
    current: {
      opens: (cluster: string | null) => cluster !== "localnet",
      getAddressUrl: (address: string, cluster: string) =>
        `https://explorer.test/address/${address}?cluster=${cluster}`,
    },
  },
  PgWeb3: {
    PublicKey: class {
      constructor(readonly value: string) {}
    },
    lamportsToSol: (lamports: number) => lamports / 1e9,
  },
}));
vi.mock("@/utils", () => utils);
vi.mock("@/hooks", () => ({ useRenderOnChange: () => undefined }));
const viewport = vi.hoisted(() => ({ current: "wide" }));
vi.mock("@/shared/lib/hooks/use-viewport", () => ({
  useViewport: () => viewport.current,
}));

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
  viewport.current = "wide";
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

const renderOpen = async () => {
  const onOpenChange = vi.fn();
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

/** The field starts at 0, so a send first needs an amount */
const enterAmount = (value: string) =>
  fireEvent.change(screen.getByLabelText("Amount (SOL)"), {
    target: { value },
  });

describe("features/fund-wallet/ui/FundDialog", () => {
  it("starts the amount at 0", async () => {
    await renderOpen();
    await connectPhantom();

    expect(
      (screen.getByLabelText("Amount (SOL)") as HTMLInputElement).value
    ).toBe("0");
    expect(sendButton().hasAttribute("disabled")).toBe(true);
  });

  it("links the receiver to the explorer on the Playground's cluster", async () => {
    await renderOpen();

    expect(
      screen.getByRole("link", { name: "9xQe…VFin" }).getAttribute("href")
    ).toBe(`https://explorer.test/address/${RECEIVER_ADDRESS}?cluster=devnet`);
  });

  it("draws the desk's foot: Cancel, then the ring Send", async () => {
    await renderOpen();
    await connectPhantom();

    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(sendButton().getAttribute("data-variant")).toBe("ring");
  });

  it("draws no foot on the desk before a payer is connected: the cross closes it", async () => {
    await renderOpen();

    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    await connectPhantom();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("draws the phone's foot: no Cancel, the accent Send", async () => {
    viewport.current = "phone";
    await renderOpen();

    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    await connectPhantom();
    expect(sendButton().getAttribute("data-variant")).toBe("accent");
  });

  it("links nothing on a cluster the explorer cannot open", async () => {
    utils.PgConnection.cluster = "localnet";
    await renderOpen();

    expect(screen.queryByRole("link", { name: "9xQe…VFin" })).toBeNull();
    expect(screen.getByText("9xQe…VFin")).toBeTruthy();
  });

  it("counts the dialog opening from the account menu", async () => {
    await renderOpen();

    expect(events("fund_dialog_opened")).toEqual([
      expect.objectContaining({ params: { via: "account-menu" } }),
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
      expect.objectContaining({ params: { wallet: "Phantom", as: "payer" } }),
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

    enterAmount("1");
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

    enterAmount("1");
    await act(async () => {
      fireEvent.click(sendButton());
    });

    expect(screen.getByRole("alert").textContent).toContain("Could not send.");
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

    enterAmount("1");
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

  it("follows the payer's account when the wallet switches it", async () => {
    await renderOpen();
    await connectPhantom();
    expect(screen.getByText("7Hq5…Xk2P")).toBeTruthy();

    await act(async () => {
      phantom.publicKey = { toBase58: () => OTHER_ADDRESS };
      phantom.emit("connect");
    });

    expect(screen.getByText("4Zr8…Mn3Q")).toBeTruthy();
    expect(screen.queryByText("7Hq5…Xk2P")).toBeNull();
    expect(utils.PgConnection.current.getBalance).toHaveBeenCalledTimes(2);
  });

  it("does not send from an account the user never saw", async () => {
    await renderOpen();
    await connectPhantom();
    enterAmount("1");
    phantom.publicKey = { toBase58: () => OTHER_ADDRESS };

    await act(async () => {
      fireEvent.click(sendButton());
    });

    expect(transfer.sendFunds).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "The wallet account changed"
    );
  });

  it("keeps a send that was not confirmed across closing and reopening", async () => {
    const { TransferNotConfirmedError } = await vi.importActual<
      typeof import("../model/transfer")
    >("../model/transfer");
    transfer.sendFunds.mockRejectedValueOnce(
      new TransferNotConfirmedError("5igNaTuRe", new Error("timed out"))
    );
    const view = render(<FundDialog open={true} onOpenChange={vi.fn()} />);
    await act(async () => undefined);
    await connectPhantom();
    enterAmount("1");
    await act(async () => {
      fireEvent.click(sendButton());
    });

    view.rerender(<FundDialog open={false} onOpenChange={vi.fn()} />);
    view.rerender(<FundDialog open={true} onOpenChange={vi.fn()} />);
    await act(async () => undefined);
    await connectPhantom();

    expect(screen.getByRole("alert").textContent).toContain("5igNaTuRe");
    expect(sendButton().hasAttribute("disabled")).toBe(true);
  });

  it("keeps a send that settles as unconfirmed after the dialog was closed", async () => {
    const { TransferNotConfirmedError } = await vi.importActual<
      typeof import("../model/transfer")
    >("../model/transfer");
    let settle: (error: unknown) => void = () => undefined;
    transfer.sendFunds.mockReturnValueOnce(
      new Promise((_, reject) => {
        settle = reject;
      })
    );
    const view = render(<FundDialog open={true} onOpenChange={vi.fn()} />);
    await act(async () => undefined);
    await connectPhantom();
    enterAmount("1");
    await act(async () => {
      fireEvent.click(sendButton());
    });

    view.rerender(<FundDialog open={false} onOpenChange={vi.fn()} />);
    await act(async () => {
      settle(new TransferNotConfirmedError("5igNaTuRe", new Error("late")));
    });
    view.rerender(<FundDialog open={true} onOpenChange={vi.fn()} />);
    await act(async () => undefined);
    await connectPhantom();

    expect(screen.getByRole("alert").textContent).toContain("5igNaTuRe");
    expect(sendButton().hasAttribute("disabled")).toBe(true);
  });

  it("holds Send while a send from an earlier opening is still pending", async () => {
    let settle: () => void = () => undefined;
    transfer.sendFunds.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        settle = resolve;
      })
    );
    const view = render(<FundDialog open={true} onOpenChange={vi.fn()} />);
    await act(async () => undefined);
    await connectPhantom();
    enterAmount("1");
    await act(async () => {
      fireEvent.click(sendButton());
    });

    view.rerender(<FundDialog open={false} onOpenChange={vi.fn()} />);
    view.rerender(<FundDialog open={true} onOpenChange={vi.fn()} />);
    await act(async () => undefined);
    await connectPhantom();

    expect(screen.getByRole("alert").textContent).toContain("still waiting");
    expect(sendButton().hasAttribute("disabled")).toBe(true);

    await act(async () => {
      settle();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when a wallet answers without connecting", async () => {
    phantom.connect.mockImplementationOnce(async () => undefined);
    await renderOpen();

    await connectPhantom();

    expect(screen.getByRole("alert").textContent).toContain(
      "Could not connect the wallet."
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
    utils.PgWallet.current = {
      isPg: false,
      name: "Phantom",
      // eslint-disable-next-line unicorn/no-null -- a disconnecting wallet's `publicKey` is `null`
      publicKey: null,
    };

    render(<FundDialog open={false} onOpenChange={vi.fn()} />);
    await renderOpen();

    expect(screen.getByText("Wallet 1")).toBeTruthy();
  });
});
