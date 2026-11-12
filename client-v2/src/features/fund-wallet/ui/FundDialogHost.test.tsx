// The one Fund dialog a short-wallet card or toast opens by asking for it
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

const RECEIVER_ADDRESS = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

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
    current: { opens: () => false, getAddressUrl: () => "" },
  },
  PgWeb3: {},
}));
vi.mock("@/utils", () => utils);
vi.mock("@/hooks", () => ({ useRenderOnChange: () => undefined }));
vi.mock("@/shared/lib/hooks/use-viewport", () => ({
  useViewport: () => "wide",
}));

import { openFundDialog } from "../model/open";
import FundDialogHost from "./FundDialogHost";

let sent: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  utils.PgWallet.current = {
    isPg: true,
    name: "Wallet 1",
    publicKey: { toBase58: () => RECEIVER_ADDRESS },
  };
  utils.PgView.setToast.mockReset();
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});
afterEach(() => {
  resetTelemetry();
});

const opened = () =>
  sent.events
    .filter((event) => event.name === "fund_dialog_opened")
    .map((event) => event.params);

describe("features/fund-wallet/ui/FundDialogHost", () => {
  it("opens the dialog when asked, and counts where from", async () => {
    render(<FundDialogHost />);
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => openFundDialog("deploy-card"));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(opened()).toEqual([{ via: "deploy-card" }]);
  });

  it("counts each opening with the entry that asked", async () => {
    render(<FundDialogHost />);

    await act(async () => openFundDialog("deploy-card"));
    await act(async () => {
      screen.getByRole("button", { name: "Close" }).click();
    });
    await act(async () => openFundDialog("tutorial-card"));

    expect(opened()).toEqual([
      { via: "deploy-card" },
      { via: "tutorial-card" },
    ]);
  });

  it("ignores a request while the dialog is open", async () => {
    render(<FundDialogHost />);

    await act(async () => openFundDialog("deploy-card"));
    await act(async () => openFundDialog("faucet-toast"));

    expect(opened()).toEqual([{ via: "deploy-card" }]);
  });

  it("says why and stays closed with no Playground wallet, then opens once there is one", async () => {
    utils.PgWallet.current = undefined;
    const accounts = utils.PgWallet.accounts;
    utils.PgWallet.accounts = [];
    render(<FundDialogHost />);

    await act(async () => openFundDialog("wallet-chip"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(utils.PgView.setToast).toHaveBeenCalledOnce();
    expect(opened()).toEqual([]);

    utils.PgWallet.accounts = accounts;
    await act(async () => openFundDialog("wallet-chip"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(opened()).toEqual([{ via: "wallet-chip" }]);
  });

  it("does nothing when asked with no host", () => {
    expect(() => openFundDialog("faucet-toast")).not.toThrow();
    expect(opened()).toEqual([]);
  });
});
