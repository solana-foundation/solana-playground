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

vi.mock("@/hooks", () => ({
  useBalance: () => 0,
  useRenderOnChange: () => undefined,
  useWallet: () => undefined,
}));
const airdrop = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/components/Wallet/hooks", () => ({
  useAirdrop: () => ({ airdrop, faucet: "available" }),
}));
vi.mock("@/utils", () => ({
  PgWallet: { current: { publicKey: { toBase58: () => ADDRESS } } },
  PgConnection: {
    cluster: "devnet",
    onDidChangeCluster: () => ({ dispose: () => undefined }),
    getAirdropAmount: () => 5,
  },
}));

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
});
