import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DefaultTheme, ThemeProvider } from "styled-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";

import { PgWallet } from "../../../utils";
import { ExportKey, ImportKey } from "./KeyFile";

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../../utils", () => ({
  PgWallet: {
    accounts: [
      {
        name: "Wallet 1",
        publicKey: "9ohTQmMgo8uYEG8DgZn2bTt1Km6WGnBUa7UNAqC3odC",
      },
    ],
    currentIndex: 0,
    add: vi.fn(),
    forgetKey: vi.fn(),
  },
}));

const CURRENT = "9ohTQmMgo8uYEG8DgZn2bTt1Km6WGnBUa7UNAqC3odC";
const IMPORTED = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

// The key page's panel, as the dialog sees it: one button per result it can hand back
vi.mock("../KeyPanel", () => ({
  KeyPanel: (props: {
    action: "import" | "export";
    publicKey?: string;
    name?: string;
    onImported?: (publicKey: string, isNew: boolean) => void;
    onExported?: () => void;
    onError: (message: string) => void;
    onBusy?: (busy: boolean) => void;
  }) => (
    <div data-public-key={props.publicKey} data-name={props.name}>
      <button
        type="button"
        onClick={() =>
          props.action === "import"
            ? props.onImported?.(IMPORTED, true)
            : props.onExported?.()
        }
      >
        panel result
      </button>
      <button type="button" onClick={() => props.onError("panel failed")}>
        panel error
      </button>
      <button type="button" onClick={() => props.onBusy?.(true)}>
        panel busy
      </button>
    </div>
  ),
}));

const blockDismiss = vi.hoisted(() => vi.fn());

vi.mock("@/widgets/overlays", () => ({
  useBlockDismiss: () => blockDismiss,
  ModalFrame: ({
    children,
    buttonProps,
  }: {
    children: React.ReactNode;
    buttonProps: { text: string; disabled?: boolean };
  }) => (
    <div>
      {children}
      <button type="button" disabled={buttonProps.disabled}>
        {buttonProps.text}
      </button>
    </div>
  ),
}));

const theme = {
  colors: { default: { textSecondary: "gray" } },
  font: { code: { size: { small: "12px" } } },
} as unknown as DefaultTheme;

const renderIn = (node: React.ReactNode) =>
  render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);

let logs: ReturnType<typeof logMemory>;
beforeEach(() => {
  logs = logMemory();
  initLogger({ providers: [logs] });
  vi.mocked(PgWallet.forgetKey).mockResolvedValue();
});
afterEach(() => {
  vi.clearAllMocks();
  resetLogger();
});

const isDoneDisabled = () =>
  screen.getByRole("button", { name: "Done" }).hasAttribute("disabled");

describe("wallet ImportKey", () => {
  it("adds the account of the key the panel stored, and says so", async () => {
    vi.mocked(PgWallet.add).mockReturnValueOnce(true);
    renderIn(<ImportKey />);

    fireEvent.click(screen.getByRole("button", { name: "panel result" }));

    expect(
      await screen.findByText("Imported 7xKX…gAsU as Wallet 1.")
    ).toBeTruthy();
    expect(PgWallet.add).toHaveBeenCalledWith({ publicKey: IMPORTED });
  });

  it("says and reports a failed add, and drops the key it newly stored", async () => {
    const failure = new Error("Wallet unavailable");
    vi.mocked(PgWallet.add).mockImplementationOnce(() => {
      throw failure;
    });
    renderIn(<ImportKey />);

    fireEvent.click(screen.getByRole("button", { name: "panel result" }));

    expect(
      await screen.findByText(
        "Could not import the keypair: Wallet unavailable"
      )
    ).toBeTruthy();
    expect(PgWallet.forgetKey).toHaveBeenCalledWith(IMPORTED);
    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0].error).toBe(failure);
  });

  it("shows the panel's error, and holds Done while it is busy", () => {
    renderIn(<ImportKey />);
    expect(isDoneDisabled()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "panel error" }));
    expect(screen.getByText("panel failed")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "panel busy" }));
    expect(isDoneDisabled()).toBe(true);
  });

  it("cannot be dismissed while the panel is busy, so the import is not lost", () => {
    blockDismiss.mockClear();
    const { unmount } = renderIn(<ImportKey />);
    expect(blockDismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "panel busy" }));
    expect(blockDismiss).toHaveBeenLastCalledWith(true);

    unmount();
    expect(blockDismiss).toHaveBeenLastCalledWith(false);
  });
});

describe("wallet ExportKey", () => {
  it("saves the current account's file, under its name", async () => {
    renderIn(<ExportKey />);

    const panel = screen.getByRole("button", { name: "panel result" })
      .parentElement as HTMLElement;
    expect(panel.dataset.publicKey).toBe(CURRENT);
    expect(panel.dataset.name).toBe("Wallet 1");
    expect(screen.getByText(/Save Wallet 1's keypair/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "panel error" }));
    expect(screen.getByText("panel failed")).toBeTruthy();
    // A save that then works clears the earlier failure
    fireEvent.click(screen.getByRole("button", { name: "panel result" }));
    await waitFor(() => expect(screen.queryByText("panel failed")).toBeNull());
  });

  it("tells its opener once the file is saved", () => {
    const onExported = vi.fn();
    renderIn(<ExportKey onExported={onExported} />);
    fireEvent.click(screen.getByRole("button", { name: "panel error" }));
    expect(onExported).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "panel result" }));
    expect(onExported).toHaveBeenCalledTimes(1);
  });

  it("holds Done while the panel is busy", () => {
    renderIn(<ExportKey />);
    fireEvent.click(screen.getByRole("button", { name: "panel busy" }));
    expect(isDoneDisabled()).toBe(true);
  });
});
