import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DefaultTheme, ThemeProvider } from "styled-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PgWallet } from "../../../utils";
import { Remove } from "./Remove";

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../../utils", () => ({
  PgWallet: {
    accounts: [],
    currentIndex: 0,
    export: vi.fn(),
    remove: vi.fn(),
    hasKeysInPage: vi.fn(),
  },
}));

// The key page's panel, as the dialog sees it: a button that reports busy
vi.mock("../KeyPanel", () => ({
  KeyPanel: (props: {
    publicKey?: string;
    name?: string;
    onBusy?: (busy: boolean) => void;
  }) => (
    <button
      type="button"
      data-public-key={props.publicKey}
      data-name={props.name}
      onClick={() => props.onBusy?.(true)}
    >
      Save keypair (panel)
    </button>
  ),
}));

vi.mock("@/widgets/overlays", () => ({
  useBlockDismiss: () => () => {},
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

const renderRemove = () =>
  render(
    <ThemeProvider theme={theme}>
      <Remove />
    </ThemeProvider>
  );

const CURRENT = {
  name: "Mine",
  publicKey: "9ohTQmMgo8uYEG8DgZn2bTt1Km6WGnBUa7UNAqC3odC",
};

const setAccounts = (accounts: typeof CURRENT[]) =>
  Object.defineProperty(PgWallet, "accounts", {
    value: accounts,
    configurable: true,
    writable: true,
  });

beforeEach(() => {
  setAccounts([CURRENT]);
  vi.mocked(PgWallet.hasKeysInPage).mockReturnValue(false);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("wallet Remove", () => {
  it("saves the keypair from the page under the local provider", async () => {
    vi.mocked(PgWallet.hasKeysInPage).mockReturnValue(true);
    renderRemove();

    fireEvent.click(screen.getByRole("button", { name: "Save keypair" }));

    await waitFor(() => expect(PgWallet.export).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole("button", { name: "Save keypair (panel)" })
    ).toBeNull();
  });

  it("offers the current account's file from the key page's panel under the key-origin provider", () => {
    renderRemove();

    const save = screen.getByRole("button", { name: "Save keypair (panel)" });
    expect(save.dataset.publicKey).toBe(CURRENT.publicKey);
    expect(save.dataset.name).toBe(CURRENT.name);
    expect(screen.queryByRole("button", { name: "Save keypair" })).toBeNull();
  });

  it("holds Remove while the panel saves the key file", () => {
    renderRemove();
    const remove = screen.getByRole("button", { name: "Remove" });
    expect(remove.hasAttribute("disabled")).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: "Save keypair (panel)" })
    );

    expect(remove.hasAttribute("disabled")).toBe(true);
    fireEvent.click(remove);
    expect(PgWallet.remove).not.toHaveBeenCalled();
  });

  it("offers no file when there is no current account", () => {
    setAccounts([]);
    renderRemove();

    expect(screen.queryByRole("button", { name: /Save keypair/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
  });
});
