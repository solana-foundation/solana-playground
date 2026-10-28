import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FC, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";
import { PgCommand, PgView, PgWallet } from "../../utils";
import { KeypairFileError } from "../../utils/wallet/keypair-file";
import Settings from "./Settings";

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../utils", () => ({
  PgCommand: { connect: { execute: vi.fn() } },
  PgView: {
    ids: { WALLET_RENAME_INPUT: "wallet-rename-input" },
    setModal: vi.fn(),
    setToast: vi.fn(),
  },
  PgWallet: {
    current: {
      isPg: true,
      publicKey: { toBase58: () => "address" },
    },
    standardWallets: [],
    accounts: [] as { name: string }[],
    currentIndex: -1,
    import: vi.fn(),
    export: vi.fn(),
  },
}));

vi.mock("../../hooks", () => ({ useCopy: () => [false, vi.fn()] }));
const airdropHook = vi.hoisted(() => ({
  airdrop: vi.fn(),
  airdropCondition: false,
}));
vi.mock("./hooks", () => ({
  useAirdrop: () => airdropHook,
  useDarken: () => ({ darken: vi.fn(), lighten: vi.fn() }),
}));

// The icons are styled-components that read the app theme; they are not what
// is under test.
vi.mock("../Icons", () => {
  const Icon = () => <svg aria-hidden />;
  return {
    Airdrop: Icon,
    Copy: Icon,
    Edit: Icon,
    ExportFile: Icon,
    ImportFile: Icon,
    Plus: Icon,
    ThreeDots: Icon,
    Trash: Icon,
  };
});
vi.mock("../Img", () => ({ default: () => null }));
vi.mock("./Modals/Add", () => ({ Add: () => null }));

const knownSignIn = vi.hoisted(() => new Error("popup blocked"));
vi.mock("../../features/auth", () => ({
  isSignInFailure: (error: unknown) => error === knownSignIn,
}));

// Each `reportButtonFailure` call: the action that did not happen, the error
// it got, and whether it was marked as already shown (logged, not toasted)
const told = vi.hoisted(
  () => [] as { action: string; error: unknown; shown: boolean }[]
);
const shown = vi.hoisted(() => new Set<unknown>());
vi.mock("@/shared/lib/report-button-failure", () => ({
  markFailureShown: (error: unknown) => shown.add(error),
  reportButtonFailure: (action: string) => (error: unknown) => {
    told.push({ action, error, shown: shown.has(error) });
  },
}));

let logs: ReturnType<typeof logMemory>;
beforeEach(() => {
  logs = logMemory();
  initLogger({ providers: [logs] });
});
afterEach(() => {
  vi.clearAllMocks();
  resetLogger();
  told.length = 0;
  airdropHook.airdropCondition = false;
  PgWallet.standardWallets.length = 0;
  PgWallet.accounts.length = 0;
});

/** What `PgWallet.import` does: append and select, or select an existing one */
const importsAs = (name: string, address: string) =>
  vi.mocked(PgWallet.import).mockImplementationOnce(async () => {
    const at = PgWallet.accounts.findIndex((account) => account.name === name);
    if (at === -1) PgWallet.accounts.push({ name } as never);
    PgWallet.currentIndex = at === -1 ? PgWallet.accounts.length - 1 : at;
    return {
      keypair: { publicKey: { toBase58: () => address } },
      added: at === -1,
    } as never;
  });

/** The text of the toast `PgView.setToast` was given */
const toastText = (call: number) => {
  const Toast = vi.mocked(PgView.setToast).mock.calls[call][0] as FC;
  return render(<Toast />).container.textContent;
};

/** What `Wallet.tsx` does: the rename input appears once `showRename` ran */
const Host = () => {
  const [rename, setRename] = useState(false);
  return (
    <>
      <Settings showRename={() => setRename(true)} />
      {rename && <input id="wallet-rename-input" aria-label="Rename" />}
    </>
  );
};

const openMenu = async () => {
  const trigger = screen.getByTitle("More");
  trigger.focus();
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return await screen.findByRole("menu");
};

describe("wallet Settings menu", () => {
  it("focuses the rename input after Rename, not the trigger", async () => {
    render(<Host />);
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));

    const input = await screen.findByLabelText("Rename");
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("leaves focus to Radix's return to the trigger after Copy address, even with the rename input mounted", async () => {
    // The input is there from the start, so only the `choseRename` guard
    // keeps focus off it
    render(
      <>
        <Settings showRename={vi.fn()} />
        <input id="wallet-rename-input" aria-label="Rename" />
      </>
    );
    const trigger = screen.getByTitle("More");
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Copy address/ }));

    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(document.activeElement).not.toBe(screen.getByLabelText("Rename"));
  });

  it("reports a modal that fails to open and tells the user", async () => {
    const failure = new Error("chunk failed");
    vi.mocked(PgView.setModal).mockRejectedValueOnce(failure);
    render(<Host />);
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Add/ }));

    await waitFor(() => expect(PgView.setToast).toHaveBeenCalledTimes(1));
    expect(vi.mocked(PgView.setToast).mock.calls[0][1]).toEqual({
      options: { name: "menu-action-failed" },
    });
    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0].ns).toBe("wallet:settings");
    expect(logs.entries[0].level).toBe("error");
    expect(logs.entries[0].report).toBe(true);
    expect(logs.entries[0].error).toBe(failure);
  });

  // A command cannot run while no terminal is mounted; the menu item must
  // say so rather than leave an unhandled rejection
  it("tells the user when Airdrop fails", async () => {
    const failure = new Error("The terminal is not open.");
    airdropHook.airdropCondition = true;
    airdropHook.airdrop.mockRejectedValueOnce(failure);
    render(<Host />);
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Airdrop/ }));

    await waitFor(() =>
      expect(told).toEqual([
        { action: "airdrop", error: failure, shown: false },
      ])
    );
  });

  it.each([
    [false, "connect Phantom"],
    [true, "disconnect from Phantom"],
  ])(
    "tells the user when the wallet item fails (connected: %s)",
    async (connected, action) => {
      const failure = new Error("The terminal is not open.");
      PgWallet.standardWallets.push({
        name: "Phantom",
        icon: "",
        connected,
      } as never);
      vi.mocked(PgCommand.connect.execute).mockRejectedValueOnce(failure);
      render(<Host />);
      await openMenu();

      fireEvent.click(screen.getByRole("menuitem", { name: /Phantom/ }));

      await waitFor(() =>
        expect(told).toEqual([{ action, error: failure, shown: false }])
      );
    }
  );

  it("says so when the imported file is not a keypair", async () => {
    vi.mocked(PgWallet.import).mockRejectedValueOnce(new KeypairFileError());
    render(<Host />);
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Import/ }));

    await waitFor(() => expect(PgView.setToast).toHaveBeenCalledTimes(1));
    expect(vi.mocked(PgView.setToast).mock.calls[0][1]).toEqual({
      options: { name: "wallet-import-not-keypair" },
    });
    expect(told).toEqual([]);
  });

  it("says which wallet Import added", async () => {
    PgWallet.accounts.push({ name: "Wallet 1" } as never);
    importsAs("Wallet 2", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
    render(<Host />);
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Import/ }));

    await waitFor(() => expect(PgView.setToast).toHaveBeenCalledTimes(1));
    expect(vi.mocked(PgView.setToast).mock.calls[0][1]).toEqual({
      options: { name: "wallet-imported" },
    });
    expect(toastText(0)).toBe("Imported 7xKX…gAsU as Wallet 2.");
  });

  it("says Import switched to a wallet that was already there", async () => {
    PgWallet.accounts.push({ name: "Wallet 1" } as never);
    importsAs("Wallet 1", "9ohTQmMgo8uYEG8DgZn2bTt1Km6WGnBUa7UNAqC3odC");
    render(<Host />);
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Import/ }));

    await waitFor(() => expect(PgView.setToast).toHaveBeenCalledTimes(1));
    expect(toastText(0)).toBe(
      "Wallet 1 already holds that keypair, so it is now the current wallet."
    );
  });

  it("says nothing when the picker is closed", async () => {
    vi.mocked(PgWallet.import).mockResolvedValueOnce(undefined);
    render(<Host />);
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Import/ }));

    await waitFor(() => expect(PgWallet.import).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(PgView.setToast).not.toHaveBeenCalled();
    expect(told).toEqual([]);
  });

  it("tells the user when Import fails for another reason", async () => {
    const failure = new Error("could not read the file");
    vi.mocked(PgWallet.import).mockRejectedValueOnce(failure);
    render(<Host />);
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Import/ }));

    await waitFor(() =>
      expect(told).toEqual([
        { action: "import the wallet", error: failure, shown: false },
      ])
    );
    expect(PgView.setToast).not.toHaveBeenCalled();
  });

  // `PgSession.signInState` holds a known failure and the account row shows
  // it: logged as a failed click, never toasted a second time
  it("leaves a cancelled or blocked sign-in to the account row", async () => {
    airdropHook.airdropCondition = true;
    airdropHook.airdrop.mockRejectedValueOnce(knownSignIn);
    render(<Host />);
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Airdrop/ }));

    await waitFor(() => expect(airdropHook.airdrop).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(told).toEqual([
      { action: "airdrop", error: knownSignIn, shown: true },
    ]);
  });
});
