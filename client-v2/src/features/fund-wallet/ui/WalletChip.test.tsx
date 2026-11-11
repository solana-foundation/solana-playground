// The connected wallet chip's "Send from your wallet" opens the one Fund dialog
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";

const ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

vi.mock("@/hooks", () => ({
  useBalance: () => 0,
  useRenderOnChange: () => undefined,
  useWallet: () => undefined,
}));
vi.mock("@/components/Wallet/hooks", () => ({
  useAirdrop: () => ({ airdrop: vi.fn(), faucet: "available" }),
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
afterEach(() => {
  stop?.();
  stop = undefined;
});

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
});
