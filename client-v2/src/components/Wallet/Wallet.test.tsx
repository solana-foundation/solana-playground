import { act, fireEvent, render, screen } from "@testing-library/react";
import { DefaultTheme, ThemeProvider } from "styled-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";

import { showWalletAbove } from "./anchor";
import Wallet, { WalletName } from "./Wallet";

// The utils barrel needs build-time globals the unit runner does not define.
const wallets = vi.hoisted(() => ({
  switch: vi.fn(),
  update: vi.fn(),
  selectStandard: vi.fn(),
  /** A deploy holds the accounts */
  held: false,
  /** Who listens for the hold; `onHold` is the wallet's subscription */
  holdListeners: new Set<(isHeld?: boolean) => void>(),
  noSubscription: () => ({ dispose: () => undefined }),
  onHold: (cb: (isHeld?: boolean) => void) => {
    wallets.holdListeners.add(cb);
    return { dispose: () => void wallets.holdListeners.delete(cb) };
  },
  standard: [] as { name: string; icon: string }[],
  isPg: true,
  show: false,
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
    selectStandard: wallets.selectStandard,
    get isSwitchHeld() {
      return wallets.held;
    },
    onDidChangeSwitchHeld: wallets.onHold,
  },
}));
vi.mock("../../hooks", async () => {
  const actual = await vi.importActual<
    typeof import("../../hooks/useRenderOnChange")
  >("../../hooks/useRenderOnChange");
  return {
    useWallet: () => ({
      name: "first",
      isPg: wallets.isPg,
      icon: "",
      publicKey: { toBase58: () => "key-first" },
    }),
    useKeybind: vi.fn(),
    useOnClickOutside: vi.fn(),
    // The real hook for the hold, so a test sees the window re-render on it;
    // every other subscription reads the fake `show`
    useRenderOnChange: (onChange: unknown) => {
      actual.useRenderOnChange(
        onChange === wallets.onHold ? wallets.onHold : wallets.noSubscription
      );
      return wallets.show;
    },
  };
});
vi.mock("./hooks", () => ({
  useDarken: () => ({ darken: vi.fn(), lighten: vi.fn() }),
}));

// The siblings of `WalletName` in the file pull in the whole wallet UI; none is
// under test.
vi.mock("./Balance", () => ({ default: () => null }));
vi.mock("./Send", () => ({ default: () => null }));
vi.mock("./Settings", () => ({ default: () => null }));
vi.mock("./Transactions", () => ({ default: () => null }));
/** Where the window was moved to after it opened */
const rnd = vi.hoisted(() => ({ moves: [] as { x: number; y: number }[] }));
vi.mock("react-rnd", async () => {
  const { forwardRef, useImperativeHandle, useRef } = await import("react");
  return {
    Rnd: forwardRef(({ style }: { style?: React.CSSProperties }, ref) => {
      const el = useRef<HTMLDivElement>(null);
      useImperativeHandle(ref, () => ({
        getSelfElement: () => el.current,
        updatePosition: (to: { x: number; y: number }) => rnd.moves.push(to),
      }));
      return <div ref={el} data-testid="wallet-window" style={style} />;
    }),
  };
});
vi.mock("../FadeIn", () => ({ default: () => null }));
vi.mock("../ErrorBoundary", () => ({ default: () => null }));
vi.mock("../Input", () => ({ default: () => null }));
vi.mock("../Img", () => ({
  default: ({ className }: { className?: string }) => (
    <i data-testid="wallet-icon" className={className} />
  ),
}));
vi.mock("../Icons", () => ({
  Close: () => null,
  ShortArrow: () => <svg aria-hidden />,
}));

// Every theme path the styled wrappers read answers with the same stand-in,
// which prints as "0" where a wrapper puts it in its CSS
const theme: DefaultTheme = new Proxy({} as DefaultTheme, {
  get: (_, key) =>
    key === Symbol.toPrimitive || key === "toString" ? () => "0" : theme,
});

beforeEach(() => {
  vi.clearAllMocks();
  wallets.standard = [];
  wallets.isPg = true;
  wallets.show = false;
  rnd.moves = [];
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

    expect(wallets.selectStandard).toHaveBeenCalledWith("Phantom");
    expect(wallets.switch).not.toHaveBeenCalled();
  });

  it("disables every account once a deploy holds them, with the window already open", async () => {
    wallets.standard = [{ name: "Phantom", icon: "phantom.svg" }];
    renderName();
    act(() => {
      wallets.held = true;
      for (const cb of wallets.holdListeners) cb(true);
    });
    try {
      const trigger = screen.getByText("first - (key-first)");
      trigger.focus();
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      await screen.findByRole("menu");
      for (const item of screen.getAllByRole("menuitem")) {
        expect(item.getAttribute("data-disabled")).not.toBeNull();
      }
    } finally {
      wallets.held = false;
    }
  });

  it("enables the accounts again once the deploy lets go of them", async () => {
    renderName();
    act(() => {
      wallets.held = true;
      for (const cb of wallets.holdListeners) cb(true);
    });
    act(() => {
      wallets.held = false;
      for (const cb of wallets.holdListeners) cb(false);
    });
    const trigger = screen.getByText("first - (key-first)");
    trigger.focus();
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    await screen.findByRole("menu");
    const items = screen.getAllByRole("menuitem");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.getAttribute("data-disabled")).toBeNull();
    }
  });

  it("draws a standard wallet's icon at the menu's icon size", async () => {
    wallets.standard = [{ name: "Phantom", icon: "phantom.svg" }];
    await openAccounts();

    const icon = screen.getByTestId("wallet-icon");
    expect(icon.classList).toContain("size-4");
    expect(icon.classList).toContain("shrink-0");
  });
});

describe("Wallet window", () => {
  it("takes z-index 30: over the cards' z-10, under the z-40 pages and z-50 dialogs", () => {
    wallets.show = true;
    render(
      <ThemeProvider theme={theme}>
        <Wallet />
      </ThemeProvider>
    );

    expect(screen.getByTestId("wallet-window").style.zIndex).toBe("30");
  });

  const renderWallet = () =>
    render(
      <ThemeProvider theme={theme}>
        <Wallet />
      </ThemeProvider>
    );

  it("opens right above the chip, right edges aligned, when the chip asks", () => {
    const chip = document.createElement("button");
    chip.getBoundingClientRect = () => ({ right: 900, top: 600 } as DOMRect);
    showWalletAbove(chip);
    wallets.show = true;
    renderWallet();

    // 320 wide; jsdom gives the window no height, so its bottom is the
    // chip's top less the 8px gap
    expect(rnd.moves.at(-1)).toEqual({ x: 580, y: 592 });
  });

  it("forgets the chip once closed, so another open keeps its usual place", () => {
    const chip = document.createElement("button");
    chip.getBoundingClientRect = () => ({ right: 900, top: 600 } as DOMRect);
    showWalletAbove(chip);
    wallets.show = true;
    renderWallet().unmount();
    rnd.moves = [];

    renderWallet();
    expect(rnd.moves).toEqual([]);
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
        name: "A wallet kept in this browser. Playground uses it to deploy and to sign your calls without asking. Use it for devnet, testnet and local clusters only.",
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
