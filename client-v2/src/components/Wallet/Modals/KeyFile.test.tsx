import { fireEvent, render, screen } from "@testing-library/react";
import { DefaultTheme, ThemeProvider } from "styled-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";

import { PgView, PgWallet } from "../../../utils";
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
  PgView: { closeModal: vi.fn(), setToast: vi.fn() },
}));

const CURRENT = "9ohTQmMgo8uYEG8DgZn2bTt1Km6WGnBUa7UNAqC3odC";
const IMPORTED = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

// The key page's panel, as the dialog sees it: one button per result it can hand back
vi.mock("../KeyPanel", () => ({
  KeyPanel: (props: {
    action: "import" | "export";
    look?: string;
    publicKey?: string;
    name?: string;
    onImported?: (publicKey: string, isNew: boolean) => void;
    onExported?: () => void;
    onError: (message: string) => void;
    onBusy?: (busy: boolean) => void;
  }) => (
    <div
      data-public-key={props.publicKey}
      data-name={props.name}
      data-look={props.look}
    >
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

const releaseDismiss = vi.hoisted(() => vi.fn());
const blockDismiss = vi.hoisted(() => vi.fn(() => releaseDismiss));

vi.mock("@/widgets/overlays", () => ({
  useBlockDismiss: () => blockDismiss,
  useModalId: () => "dialog-1",
  // A footer would be a button of its own; the panel is the dialog's one action
  ModalFrame: ({
    children,
    buttonProps,
  }: {
    children: React.ReactNode;
    buttonProps?: unknown;
  }) => <div data-footer={buttonProps !== undefined}>{children}</div>,
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

/** The panel as the dialog drew it, and whether the dialog has a footer */
const panelOf = () =>
  screen.getByRole("button", { name: "panel result" })
    .parentElement as HTMLElement;
const hasFooter = () =>
  (panelOf().parentElement?.parentElement as HTMLElement).dataset.footer;

/** The text of the last toast */
const toastText = () => {
  const [Toast] = vi.mocked(PgView.setToast).mock.calls.at(-1) as unknown as [
    () => React.ReactElement<{ children: string }>
  ];
  return Toast().props.children;
};

describe("wallet ImportKey", () => {
  it("adds the account of the key the panel stored, closes and says so in a toast", () => {
    vi.mocked(PgWallet.add).mockReturnValueOnce(true);
    renderIn(<ImportKey />);
    expect(panelOf().dataset.look).toBe("primary");
    expect(hasFooter()).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "panel result" }));

    expect(PgWallet.add).toHaveBeenCalledWith({ publicKey: IMPORTED });
    expect(PgView.closeModal).toHaveBeenCalledWith(undefined, "dialog-1");
    expect(toastText()).toBe("Imported 7xKX…gAsU as Wallet 1.");
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
    expect(PgView.closeModal).not.toHaveBeenCalled();
    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0].error).toBe(failure);
  });

  it("shows the panel's error and stays open", () => {
    renderIn(<ImportKey />);

    fireEvent.click(screen.getByRole("button", { name: "panel error" }));
    expect(screen.getByText("panel failed")).toBeTruthy();
    expect(PgView.closeModal).not.toHaveBeenCalled();
  });

  it("cannot be dismissed while the panel is busy, so the import is not lost", () => {
    blockDismiss.mockClear();
    releaseDismiss.mockClear();
    const { unmount } = renderIn(<ImportKey />);
    expect(blockDismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "panel busy" }));
    expect(blockDismiss).toHaveBeenCalledTimes(1);
    expect(releaseDismiss).not.toHaveBeenCalled();

    unmount();
    expect(releaseDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("wallet ExportKey", () => {
  it("saves the current account's file, under its name, and closes", () => {
    renderIn(<ExportKey />);

    const panel = panelOf();
    expect(panel.dataset.publicKey).toBe(CURRENT);
    expect(panel.dataset.name).toBe("Wallet 1");
    expect(panel.dataset.look).toBe("primary");
    expect(hasFooter()).toBe("false");
    expect(screen.getByText(/Save Wallet 1's keypair/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "panel error" }));
    expect(screen.getByText("panel failed")).toBeTruthy();
    expect(PgView.closeModal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "panel result" }));
    expect(PgView.closeModal).toHaveBeenCalledWith(undefined, "dialog-1");
  });
});
