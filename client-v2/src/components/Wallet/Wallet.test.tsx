import { fireEvent, render, screen } from "@testing-library/react";
import { DefaultTheme, ThemeProvider } from "styled-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";

import { WalletName } from "./Wallet";

// The utils barrel needs build-time globals the unit runner does not define.
const wallets = vi.hoisted(() => ({
  switch: vi.fn(),
  update: vi.fn(),
  standard: [] as { name: string; icon: string }[],
  isPg: true,
}));
vi.mock("../../utils", () => ({
  PgCommon: {
    withMaxLength: (text: string) => text,
    shorten: (text: string) => text,
  },
  PgTheme: { convertToCSS: () => "" },
  PgView: { ids: {}, classNames: {} },
  PgWallet: {
    accounts: [{ name: "first" }, { name: "second" }],
    // The fake account is its own wallet name
    create: (acc: { name: string }) => ({
      name: acc.name,
      isPg: true,
      icon: "",
      publicKey: { toBase58: () => "key-" + acc.name },
    }),
    getConnectedStandardWallets: () =>
      wallets.standard.map((standard) => ({
        name: standard.name,
        isPg: false,
        icon: standard.icon,
        publicKey: { toBase58: () => "key-" + standard.name },
      })),
    switch: wallets.switch,
    update: wallets.update,
  },
}));
vi.mock("../../hooks", () => ({
  useWallet: () => ({
    name: "first",
    isPg: wallets.isPg,
    icon: "",
    publicKey: { toBase58: () => "key-first" },
  }),
  useKeybind: vi.fn(),
  useOnClickOutside: vi.fn(),
  useRenderOnChange: vi.fn(),
}));
vi.mock("./hooks", () => ({
  useDarken: () => ({ darken: vi.fn(), lighten: vi.fn() }),
}));

// The siblings of `WalletName` in the file pull in the whole wallet UI; none is
// under test.
vi.mock("./Balance", () => ({ default: () => null }));
vi.mock("./Send", () => ({ default: () => null }));
vi.mock("./Settings", () => ({ default: () => null }));
vi.mock("./Transactions", () => ({ default: () => null }));
vi.mock("react-rnd", () => ({ Rnd: () => null }));
vi.mock("../FadeIn", () => ({ default: () => null }));
vi.mock("../ErrorBoundary", () => ({ default: () => null }));
vi.mock("../Input", () => ({ default: () => null }));
vi.mock("../Img", () => ({ default: () => null }));
vi.mock("../Icons", () => ({
  Close: () => null,
  ShortArrow: () => <svg aria-hidden />,
}));

// Every theme path the styled wrappers read answers with the same stand-in
const theme: DefaultTheme = new Proxy({} as DefaultTheme, { get: () => theme });

beforeEach(() => {
  vi.clearAllMocks();
  wallets.standard = [];
  wallets.isPg = true;
});

const renderName = () =>
  render(
    <ThemeProvider theme={theme}>
      <TooltipProvider>
        <WalletName />
      </TooltipProvider>
    </ThemeProvider>
  );

const openAccounts = async () => {
  renderName();
  // The trigger takes the ref through the tooltip and the dropdown, two `asChild` slots
  const trigger = screen.getByText("first - (key-first)");
  trigger.focus();
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return await screen.findByRole("menu");
};

describe("WalletName accounts menu", () => {
  it("opens from the title and switches to the chosen Playground account", async () => {
    await openAccounts();

    fireEvent.click(
      screen.getByRole("menuitem", { name: "second - (key-second)" })
    );

    expect(wallets.switch).toHaveBeenCalledTimes(1);
    expect(wallets.switch).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("selects a connected standard wallet by its name", async () => {
    wallets.standard = [{ name: "Phantom", icon: "phantom.svg" }];
    await openAccounts();

    fireEvent.click(
      screen.getByRole("menuitem", { name: "Phantom - (key-Phantom)" })
    );

    expect(wallets.update).toHaveBeenCalledWith({
      state: "sol",
      standardName: "Phantom",
    });
    expect(wallets.switch).not.toHaveBeenCalled();
  });
});

/** The tooltip's popper measures itself; jsdom has no `ResizeObserver` */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("WalletName help", () => {
  beforeEach(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterEach(() => vi.unstubAllGlobals());

  it("explains the Playground wallet beside its name (Spec 12)", async () => {
    renderName();

    const mark = screen.getByRole("button", {
      name: "About the Playground wallet",
    });
    fireEvent.focus(mark);

    expect(
      await screen.findByRole("tooltip", {
        name: "A wallet kept in this browser. Playground uses it to sign your calls without asking. Use it for devnet, testnet and local clusters only.",
      })
    ).toBeTruthy();
  });

  it("has no help mark on an extension wallet", () => {
    wallets.isPg = false;
    renderName();

    expect(
      screen.queryByRole("button", { name: "About the Playground wallet" })
    ).toBeNull();
  });
});
