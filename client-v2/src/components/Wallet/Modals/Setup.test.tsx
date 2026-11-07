import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DefaultTheme, ThemeProvider } from "styled-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";

import { PgWallet } from "../../../utils";
import { KeypairFileError } from "../../../utils/wallet/keypair-file";
import { Setup } from "./Setup";

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../../utils", () => ({
  PgWallet: {
    accounts: [{ name: "Wallet 1", kp: [] }],
    currentIndex: 0,
    add: vi.fn(),
    export: vi.fn(),
    import: vi.fn(),
    remove: vi.fn(),
    getNextAvailableAccountName: () => "Wallet 1",
    holdsKeysInPage: vi.fn(() => true),
    makeKey: vi.fn(),
    forgetKey: vi.fn(),
  },
  PgWeb3: { Keypair: { generate: () => ({}) } },
}));

// The key page's panel, as the dialog sees it: a button per panel, and the
// results it hands back
vi.mock("../KeyPanel", () => ({
  KeyPanel: (props: {
    action: "import" | "export";
    publicKey?: string;
    name?: string;
    onImported?: (publicKey: string, isNew: boolean) => void;
    onError: (message: string) => void;
    onBusy?: (busy: boolean) => void;
  }) => (
    <>
      {props.action === "import" && (
        <button type="button" onClick={() => props.onBusy?.(true)}>
          panel busy
        </button>
      )}
      <button
        type="button"
        data-public-key={props.publicKey}
        data-name={props.name}
        onClick={() =>
          props.action === "import"
            ? props.onImported?.(IMPORTED, true)
            : props.onError("No key for that account")
        }
      >
        {props.action === "import" ? "Import keypair" : "Save keypair"} (panel)
      </button>
    </>
  ),
  KeyPanelUnavailable: () => (
    <p>Key storage didn't load. Reload the page and try again.</p>
  ),
}));

const IMPORTED = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

// The frame is the overlay system's; what is under test is the body, and
// what Continue does.
vi.mock("@/widgets/overlays", () => ({
  ModalFrame: ({
    children,
    buttonProps,
  }: {
    children: React.ReactNode;
    buttonProps: { text: string; onSubmit: () => unknown; disabled?: boolean };
  }) => (
    <div>
      {children}
      <button
        type="button"
        disabled={buttonProps.disabled}
        onClick={() => void buttonProps.onSubmit()}
      >
        {buttonProps.text}
      </button>
    </div>
  ),
}));

const theme = {
  colors: { default: { textSecondary: "gray" } },
  font: { code: { size: { small: "12px" } } },
} as unknown as DefaultTheme;

const renderSetup = () =>
  render(
    <ThemeProvider theme={theme}>
      <Setup />
    </ThemeProvider>
  );

let logs: ReturnType<typeof logMemory>;
beforeEach(() => {
  logs = logMemory();
  initLogger({ providers: [logs] });
});
afterEach(() => {
  vi.clearAllMocks();
  resetLogger();
});

describe("wallet Setup", () => {
  it("keeps the current wallet when a keypair is imported", async () => {
    vi.mocked(PgWallet.import).mockResolvedValueOnce({
      keypair: {
        publicKey: {
          toBase58: () => "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        },
      },
      added: true,
    } as never);
    renderSetup();

    fireEvent.click(screen.getByRole("button", { name: "Import keypair" }));

    expect(
      await screen.findByText("Imported 7xKX…gAsU as Wallet 1.")
    ).toBeTruthy();
    expect(PgWallet.remove).not.toHaveBeenCalled();
  });

  it("says the import switched to a wallet that already held the keypair", async () => {
    vi.mocked(PgWallet.import).mockResolvedValueOnce({
      keypair: { publicKey: { toBase58: () => "9ohTQmMg" } },
      added: false,
    } as never);
    renderSetup();

    fireEvent.click(screen.getByRole("button", { name: "Import keypair" }));

    expect(
      await screen.findByText(
        "Wallet 1 already holds that keypair, so it is now the current wallet."
      )
    ).toBeTruthy();
  });

  it("says nothing when the file picker is closed", async () => {
    const failure = new KeypairFileError();
    vi.mocked(PgWallet.import)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    renderSetup();
    const button = screen.getByRole("button", { name: "Import keypair" });

    fireEvent.click(button);
    await screen.findByText(failure.message);
    fireEvent.click(button);

    // The earlier failure is cleared, not left standing as if it were current
    await waitFor(() => expect(screen.queryByText(failure.message)).toBeNull());
    expect(screen.queryByText(/Imported|Could not/)).toBeNull();
    expect(PgWallet.remove).not.toHaveBeenCalled();
    expect(logs.entries).toEqual([]);
  });

  it("reports any other failure and shows it", async () => {
    const failure = new Error("could not read the file");
    vi.mocked(PgWallet.import).mockRejectedValueOnce(failure);
    renderSetup();

    fireEvent.click(screen.getByRole("button", { name: "Import keypair" }));

    expect(
      await screen.findByText(
        "Could not import the keypair: could not read the file"
      )
    ).toBeTruthy();
    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0].report).toBe(true);
    expect(logs.entries[0].error).toBe(failure);
  });

  it("says so when the file is not a keypair, without reporting it", async () => {
    const failure = new KeypairFileError();
    vi.mocked(PgWallet.import).mockRejectedValueOnce(failure);
    renderSetup();

    fireEvent.click(screen.getByRole("button", { name: "Import keypair" }));

    expect(await screen.findByText(failure.message)).toBeTruthy();
    expect(PgWallet.remove).not.toHaveBeenCalled();
    expect(logs.entries).toEqual([]);
  });
});

describe("wallet Setup under the key-origin provider", () => {
  const MADE = "9ohTQmMgo8uYEG8DgZn2bTt1Km6WGnBUa7UNAqC3odC";
  let accounts: { name: string; publicKey: string }[];

  beforeEach(() => {
    accounts = [];
    vi.mocked(PgWallet.holdsKeysInPage).mockReturnValue(false);
    vi.mocked(PgWallet.makeKey).mockResolvedValue(MADE);
    vi.mocked(PgWallet.forgetKey).mockResolvedValue();
    Object.defineProperty(PgWallet, "accounts", {
      get: () => accounts,
      configurable: true,
    });
    vi.mocked(PgWallet.add).mockImplementation((params) => {
      accounts.push({ name: "Wallet 1", publicKey: params?.publicKey ?? "" });
      return true;
    });
  });
  afterEach(() => {
    vi.mocked(PgWallet.holdsKeysInPage).mockReturnValue(true);
    Object.defineProperty(PgWallet, "accounts", {
      value: [{ name: "Wallet 1", kp: [] }],
      configurable: true,
      writable: true,
    });
  });

  it("offers the file of a key made in the key page, and adds it on Continue", async () => {
    const { unmount } = renderSetup();

    const save = await screen.findByRole("button", {
      name: "Save keypair (panel)",
    });
    expect(save.dataset.publicKey).toBe(MADE);
    expect(save.dataset.name).toBe("Wallet 1");
    expect(PgWallet.export).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(PgWallet.add).toHaveBeenCalledWith({ publicKey: MADE })
    );
    unmount();
    // The account took the key: closing drops nothing it holds
    await waitFor(() => expect(PgWallet.forgetKey).toHaveBeenCalledWith(MADE));
  });

  it("drops the made key when closed without Continue", async () => {
    const { unmount } = renderSetup();
    await screen.findByRole("button", { name: "Save keypair (panel)" });

    unmount();

    await waitFor(() => expect(PgWallet.forgetKey).toHaveBeenCalledWith(MADE));
    expect(PgWallet.add).not.toHaveBeenCalled();
  });

  it("adds the account of a key the import panel stored, and says so", async () => {
    renderSetup();

    fireEvent.click(
      screen.getByRole("button", { name: "Import keypair (panel)" })
    );

    expect(
      await screen.findByText("Imported 7xKX…gAsU as Wallet 1.")
    ).toBeTruthy();
    expect(PgWallet.add).toHaveBeenCalledWith({ publicKey: IMPORTED });
    expect(PgWallet.import).not.toHaveBeenCalled();
    // The export now saves the imported account, as the local Setup does
    expect(
      screen.getByRole("button", { name: "Save keypair (panel)" }).dataset
        .publicKey
    ).toBe(IMPORTED);
  });

  it("shows the panel's error in the dialog's text", async () => {
    renderSetup();

    fireEvent.click(
      await screen.findByRole("button", { name: "Save keypair (panel)" })
    );

    expect(await screen.findByText("No key for that account")).toBeTruthy();
  });

  it("holds Continue while a panel is busy", async () => {
    renderSetup();
    await screen.findByRole("button", { name: "Save keypair (panel)" });
    const isHeld = () =>
      screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled");
    expect(isHeld()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "panel busy" }));

    expect(isHeld()).toBe(true);
  });

  it("says the key storage did not load when the key cannot be made", async () => {
    vi.mocked(PgWallet.makeKey).mockRejectedValueOnce(new Error("gone"));
    renderSetup();

    expect(
      await screen.findByText(
        "Key storage didn't load. Reload the page and try again."
      )
    ).toBeTruthy();
  });
});
