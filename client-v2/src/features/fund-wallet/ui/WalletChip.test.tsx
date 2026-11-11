// The connected wallet chip: "Send from your wallet" opens the one Fund dialog,
// and any refused airdrop opens the web faucet's steps
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AirdropRefusedError } from "@/commands/airdrop/report";
import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { TooltipProvider } from "@/shared/ui/tooltip";

const ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

const balanceNow = vi.hoisted(() => ({ sol: 0 }));
const clusterNow = vi.hoisted(() => ({ name: "devnet" }));
const airdropAmount = vi.hoisted(() => ({ sol: 5 as number | null }));
vi.mock("@/hooks", () => ({
  useBalance: () => balanceNow.sol,
  useRenderOnChange: () => undefined,
  useWallet: () => undefined,
}));
const airdrop = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/components/Wallet/hooks", () => ({
  useAirdrop: () => ({ airdrop, faucet: "available" }),
}));
const connectStandard = vi.hoisted(() => ({
  make: vi.fn<(name: string, stillWanted: () => boolean) => Promise<void>>(
    async () => {}
  ),
  drop: vi.fn<(name: string) => Promise<void>>(async () => {}),
}));
vi.mock("@/commands/connect/connect", () => ({
  setStandardCurrentWith: (stillWanted: () => boolean) => (name: string) =>
    connectStandard.make(name, stillWanted),
  disconnectStandard: connectStandard.drop,
}));
const current = vi.hoisted(() => ({
  wallet: {
    isPg: true,
    publicKey: {
      toBase58: () => "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    },
  } as {
    isPg?: boolean;
    name?: string;
    icon?: string;
    publicKey: { toBase58: () => string };
  },
}));
vi.mock("@/utils", () => ({
  PgWallet: {
    get current() {
      return current.wallet;
    },
    standardWallets: [
      { name: "Phantom", icon: "data:," },
      { name: "Solflare", icon: "data:," },
    ],
  },
  PgConnection: {
    get cluster() {
      return clusterNow.name;
    },
    onDidChangeCluster: () => ({ dispose: () => undefined }),
    getAirdropAmount: () => airdropAmount.sol,
  },
}));

import { PgDeployRun } from "@/commands/deploy/run";

import { onDidRequestFundDialog } from "../model/open";
import WalletChip from "./WalletChip";

let stop: (() => void) | undefined;
let sent: ReturnType<typeof memoryProvider>;
let logs: ReturnType<typeof logMemory>;
beforeEach(() => {
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  logs = logMemory();
  initLogger({ providers: [logs] });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  resetTelemetry();
  resetLogger();
  airdrop.mockReset();
  connectStandard.make.mockReset();
  connectStandard.drop.mockReset();
  current.wallet = { isPg: true, publicKey: { toBase58: () => ADDRESS } };
  balanceNow.sol = 0;
  clusterNow.name = "devnet";
  airdropAmount.sol = 5;
});

const renderChip = (isSignInFailure: (e: unknown) => boolean) =>
  render(
    <TooltipProvider>
      <WalletChip signedOut={false} isSignInFailure={isSignInFailure} />
    </TooltipProvider>
  );

/** Opens the popover and asks the faucet, letting the refusal settle */
const getSol = async () => {
  fireEvent.click(screen.getByRole("button", { name: /^Wallet 7xKX…gAsU/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Get / }));
  });
};

/** The connect events the chip sent, as [name, params] */
const chipEvents = () =>
  sent.events
    .filter((event) => /^fund_wallet_/.test(event.name))
    .map((event) => [event.name, event.params]);

const refusals = () =>
  sent.events
    .filter((event) => event.name === "fund_airdrop_refused")
    .map((event) => event.params);

describe("features/fund-wallet/ui/WalletChip", () => {
  it("opens the one Fund dialog from Send from your wallet", () => {
    const asked: string[] = [];
    stop = onDidRequestFundDialog((from) => asked.push(from));
    render(
      <TooltipProvider>
        <WalletChip signedOut={false} isSignInFailure={() => false} />
      </TooltipProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /^Wallet 7xKX…gAsU/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Send from your wallet" })
    );

    expect(asked).toEqual(["wallet-chip"]);
  });

  it.each([
    {
      cause: "the limit",
      message: "429 Too Many Requests",
      headline: "The faucet is at its limit",
      reason: "rate-limited",
      errorsLogged: 0,
    },
    {
      cause: "anything else",
      message: "fetch failed",
      headline: "The faucet did not send SOL",
      reason: "failed",
      errorsLogged: 1,
    },
  ])(
    "spells out the web faucet for a refusal for $cause",
    async ({ message, headline, reason, errorsLogged }) => {
      airdrop.mockRejectedValueOnce(
        new AirdropRefusedError(new Error(message))
      );
      renderChip(() => false);
      await getSol();

      expect(screen.getByText(headline)).toBeTruthy();
      expect(
        screen.getByRole("list", { name: "Get SOL from the web faucet" })
      ).toBeTruthy();
      expect(refusals()).toEqual([{ reason }]);
      // Only a refusal other than the limit is logged as an error, and the
      // popover is its only notice: no "Could not airdrop" toast on top
      expect(logs.entries.filter((e) => e.level === "error")).toHaveLength(
        errorsLogged
      );
      expect(screen.queryByText(/Could not airdrop/)).toBeNull();
    }
  );

  it("shows no faucet steps when the sign-in failed before the faucet was asked", async () => {
    const failure = new Error("Sign-in cancelled");
    airdrop.mockRejectedValueOnce(failure);
    renderChip((e) => e === failure);
    await getSol();

    expect(
      screen.queryByRole("list", { name: "Get SOL from the web faucet" })
    ).toBeNull();
  });

  it("names a connected extension, which leaves `isPg` unset, and disconnects it", async () => {
    current.wallet = {
      name: "Phantom",
      icon: "data:,",
      publicKey: { toBase58: () => ADDRESS },
    };
    renderChip(() => false);
    fireEvent.click(screen.getByRole("button", { name: /^Wallet 7xKX…gAsU/ }));
    expect(screen.queryByText("Playground wallet")).toBeNull();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Disconnect Phantom" })
      );
    });
    expect(connectStandard.drop).toHaveBeenCalledWith("Phantom");
    expect(chipEvents()).toEqual([
      ["fund_wallet_disconnected", { wallet: "Phantom" }],
    ]);
  });

  it("holds Disconnect while a deploy from the extension runs", () => {
    current.wallet = {
      name: "Phantom",
      icon: "data:,",
      publicKey: { toBase58: () => ADDRESS },
    };
    renderChip(() => false);
    act(() => PgDeployRun.update({ step: "write" }));
    try {
      fireEvent.click(
        screen.getByRole("button", { name: /^Wallet 7xKX…gAsU/ })
      );
      const disconnect = screen.getByRole("button", {
        name: "Disconnect Phantom",
      });
      expect((disconnect as HTMLButtonElement).disabled).toBe(true);
      expect(
        screen.getByText("Disconnect after the deploy finishes")
      ).toBeTruthy();
    } finally {
      act(() => PgDeployRun.reset());
    }
  });

  it("offers no Connect while a deploy runs from the Playground wallet", () => {
    renderChip(() => false);
    act(() => PgDeployRun.update({ step: "write" }));
    try {
      fireEvent.click(
        screen.getByRole("button", { name: /^Wallet 7xKX…gAsU/ })
      );
      expect(
        screen.queryByRole("button", { name: "Connect a wallet" })
      ).toBeNull();
    } finally {
      act(() => PgDeployRun.reset());
    }
  });

  it("names the 5 SOL default in the faucet steps and link when the airdrop amount is unknown", async () => {
    airdropAmount.sol = null;
    airdrop.mockRejectedValueOnce(
      new AirdropRefusedError(new Error("429 Too Many Requests"))
    );
    renderChip(() => false);
    await getSol();

    expect(
      screen.getByText(/Your address and 5 SOL are filled in/)
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: /Open the web faucet/ });
    expect(link.getAttribute("href")).toContain("amount=5");
  });

  describe("the airdrop state belongs to one wallet on one cluster", () => {
    const OTHER = "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT";
    const received = () =>
      sent.events.filter((event) => event.name === "fund_airdrop_received");

    /** Refused by the faucet, then off to the web faucet to wait there */
    const waitAtTheWebFaucet = async () => {
      airdrop.mockRejectedValueOnce(
        new AirdropRefusedError(new Error("429 Too Many Requests"))
      );
      const view = renderChip(() => false);
      await getSol();
      fireEvent.click(
        screen.getByRole("link", { name: /Open the web faucet/ })
      );
      return view;
    };

    it("does not count another wallet's balance as SOL received", async () => {
      const view = await waitAtTheWebFaucet();

      current.wallet = {
        name: "Phantom",
        icon: "data:,",
        publicKey: { toBase58: () => OTHER },
      };
      balanceNow.sol = 2;
      view.rerender(
        <TooltipProvider>
          <WalletChip signedOut={false} isSignInFailure={() => false} />
        </TooltipProvider>
      );

      expect(received()).toEqual([]);
      expect(screen.queryByText(/Got /)).toBeNull();
    });

    it("drops a refusal when the cluster changes", async () => {
      airdrop.mockRejectedValueOnce(
        new AirdropRefusedError(new Error("429 Too Many Requests"))
      );
      const view = renderChip(() => false);
      await getSol();
      expect(screen.getByText("The faucet is at its limit")).toBeTruthy();

      clusterNow.name = "testnet";
      view.rerender(
        <TooltipProvider>
          <WalletChip signedOut={false} isSignInFailure={() => false} />
        </TooltipProvider>
      );

      expect(screen.queryByText("The faucet is at its limit")).toBeNull();
    });
  });

  describe("connecting a wallet", () => {
    const openList = () => {
      fireEvent.click(
        screen.getByRole("button", { name: /^Wallet 7xKX…gAsU/ })
      );
      fireEvent.click(screen.getByRole("button", { name: "Connect a wallet" }));
    };

    it("lists the installed wallets and connects the one picked", async () => {
      renderChip(() => false);
      openList();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Phantom" }));
      });
      expect(connectStandard.make).toHaveBeenCalledWith(
        "Phantom",
        expect.any(Function)
      );
      expect(chipEvents()).toEqual([
        ["fund_wallet_connect_started", { wallet: "Phantom" }],
        ["fund_wallet_connected", { wallet: "Phantom", as: "current" }],
      ]);
    });

    it("keeps waiting across a close and a reopen, until the extension answers", async () => {
      let approve = () => {};
      connectStandard.make.mockImplementation(
        () => new Promise<void>((resolve) => (approve = resolve))
      );
      renderChip(() => false);
      openList();
      fireEvent.click(screen.getByRole("button", { name: "Phantom" }));
      expect(screen.getByText("Waiting for Phantom…")).toBeTruthy();

      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
      });
      fireEvent.click(
        screen.getByRole("button", { name: /^Wallet 7xKX…gAsU/ })
      );
      expect(screen.getByText("Waiting for Phantom…")).toBeTruthy();

      await act(async () => approve());
      expect(screen.queryByText("Waiting for Phantom…")).toBeNull();
    });

    it("tells a superseded approval not to take over, and still logs its failure", async () => {
      const asked: { name: string; stillWanted?: () => boolean }[] = [];
      const answers: { approve: () => void; fail: (e: Error) => void }[] = [];
      connectStandard.make.mockImplementation(
        (name, stillWanted) =>
          new Promise<void>((resolve, reject) => {
            asked.push({ name, stillWanted });
            answers.push({ approve: resolve, fail: reject });
          })
      );
      const view = renderChip(() => false);
      openList();
      fireEvent.click(screen.getByRole("button", { name: "Phantom" }));

      // Another way made a wallet current and dropped it again, which ended
      // the wait; the user then picks again
      const rerender = () =>
        view.rerender(
          <TooltipProvider>
            <WalletChip signedOut={false} isSignInFailure={() => false} />
          </TooltipProvider>
        );
      const playground = current.wallet;
      current.wallet = {
        name: "Solflare",
        icon: "data:,",
        publicKey: { toBase58: () => ADDRESS },
      };
      rerender();
      current.wallet = playground;
      rerender();
      fireEvent.click(screen.getByRole("button", { name: "Connect a wallet" }));
      fireEvent.click(screen.getByRole("button", { name: "Phantom" }));
      expect(asked.map((a) => a.name)).toEqual(["Phantom", "Phantom"]);

      const [first, second] = asked;
      expect(first.stillWanted?.()).toBe(false);
      expect(second.stillWanted?.()).toBe(true);

      await act(async () => answers[0].fail(new Error("socket hung up")));
      expect(
        logs.entries.filter((e) => e.level === "error" || e.level === "warn")
      ).toHaveLength(1);
    });

    it("says a decline kept the Playground wallet", async () => {
      connectStandard.make.mockRejectedValue(
        new Error("User rejected the request.")
      );
      renderChip(() => false);
      openList();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Phantom" }));
      });
      expect(
        screen.getByText(
          "Phantom didn't connect. The Playground wallet is in use."
        )
      ).toBeTruthy();
      expect(chipEvents().at(-1)).toEqual([
        "fund_wallet_connect_failed",
        { wallet: "Phantom", reason: "rejected" },
      ]);
    });
  });
});
