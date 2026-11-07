import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DefaultTheme, ThemeProvider } from "styled-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PgWallet } from "../../../utils";
import { Add } from "./Add";

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../../utils", () => ({
  PgWallet: {
    accounts: [],
    currentIndex: 0,
    add: vi.fn(),
    getNextAvailableAccountName: () => "Wallet 2",
    validateAccountName: () => true,
    holdsKeysInPage: () => false,
    makeKey: vi.fn(),
    forgetKey: vi.fn(),
  },
  PgView: { classNames: { ERROR: "error", TOUCHED: "touched" } },
  PgWeb3: { Keypair: { generate: () => ({}) } },
}));

// The key page's panel, as the dialog sees it: a button that reports busy
vi.mock("../KeyPanel", () => ({
  KeyPanel: (props: {
    publicKey?: string;
    name?: string;
    className?: string;
    onBusy?: (busy: boolean) => void;
  }) => (
    <button
      type="button"
      data-public-key={props.publicKey}
      data-name={props.name}
      className={props.className}
      onClick={() => props.onBusy?.(true)}
    >
      Save keypair (panel)
    </button>
  ),
  KeyPanelUnavailable: () => (
    <p>Key storage didn't load. Reload the page and try again.</p>
  ),
}));

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

const renderAdd = () =>
  render(
    <ThemeProvider theme={theme}>
      <Add />
    </ThemeProvider>
  );

const MADE = "9ohTQmMgo8uYEG8DgZn2bTt1Km6WGnBUa7UNAqC3odC";

beforeEach(() => {
  vi.mocked(PgWallet.makeKey).mockResolvedValue(MADE);
  vi.mocked(PgWallet.forgetKey).mockResolvedValue();
  vi.mocked(PgWallet.add).mockReturnValue(true);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("wallet Add under the key-origin provider", () => {
  it("adds the key made in the key page under the typed name", async () => {
    renderAdd();
    const save = await screen.findByRole("button", {
      name: "Save keypair (panel)",
    });
    expect(save.dataset.publicKey).toBe(MADE);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Mine" },
    });
    expect(save.dataset.name).toBe("Mine");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(PgWallet.add).toHaveBeenCalledWith({
        name: "Mine",
        publicKey: MADE,
      })
    );
  });

  it("drops the made key when closed", async () => {
    const { unmount } = renderAdd();
    await screen.findByRole("button", { name: "Save keypair (panel)" });

    unmount();

    await waitFor(() => expect(PgWallet.forgetKey).toHaveBeenCalledWith(MADE));
    expect(PgWallet.add).not.toHaveBeenCalled();
  });

  it("holds Create while the panel is busy", async () => {
    renderAdd();
    fireEvent.click(
      await screen.findByRole("button", { name: "Save keypair (panel)" })
    );
    expect(
      screen.getByRole("button", { name: "Create" }).hasAttribute("disabled")
    ).toBe(true);
  });

  it("keeps the button's place while the key is made, at the panel's offset", async () => {
    let made: (key: string) => void = () => {};
    vi.mocked(PgWallet.makeKey).mockReturnValueOnce(
      new Promise((resolve) => (made = resolve))
    );
    renderAdd();

    const placeholder = screen.getByRole("button", { name: "Save keypair" });
    expect(placeholder.hasAttribute("disabled")).toBe(true);
    expect(placeholder.className).toContain("mt-2");
    made(MADE);
    const panel = await screen.findByRole("button", {
      name: "Save keypair (panel)",
    });
    expect(panel.className).toContain("mt-2");
  });

  it("says the key storage did not load when making the key throws at once", async () => {
    vi.mocked(PgWallet.makeKey).mockImplementationOnce(() => {
      throw new Error("Wallet unavailable");
    });
    renderAdd();

    expect(
      await screen.findByText(
        "Key storage didn't load. Reload the page and try again."
      )
    ).toBeTruthy();
  });
});
