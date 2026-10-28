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
    add: vi.fn(),
    export: vi.fn(),
    import: vi.fn(),
    remove: vi.fn(),
    getNextAvailableAccountName: () => "Wallet 1",
  },
  PgWeb3: { Keypair: { generate: () => ({}) } },
}));

// The frame is the overlay system's; what is under test is the body.
vi.mock("@/widgets/overlays", () => ({
  ModalFrame: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
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
      keypair: { publicKey: { toBase58: () => "NewAddress" } },
      added: true,
    } as never);
    renderSetup();

    fireEvent.click(screen.getByRole("button", { name: "Import keypair" }));

    expect(
      await screen.findByText("Imported address: NewAddress")
    ).toBeTruthy();
    expect(PgWallet.remove).not.toHaveBeenCalled();
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
    expect(screen.queryByText(/Imported address|Could not/)).toBeNull();
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
