// A file of its own: `src/commands/` is a runtime module the UI move rule
// never touches, and it mocks modules, so it stays out of the modules
// (AGENTS.md)
import { beforeEach, describe, expect, it, vi } from "vitest";

const wallets = vi.hoisted(() => ({
  list: [] as {
    name: string;
    connected: boolean;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[],
}));
const update = vi.hoisted(() => vi.fn());

vi.mock("../../utils", () => ({
  PgCommon: { sleep: vi.fn() },
  PgTerminal: { println: vi.fn(), success: String, bold: String },
  PgView: {},
  PgWallet: {
    get standardWallets() {
      return wallets.list;
    },
    update,
  },
}));

import { disconnectStandard, makeStandardCurrent } from "./connect";

const phantom = (connected: boolean) => ({
  name: "Phantom",
  connected,
  connect: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
});

beforeEach(() => update.mockClear());

describe("commands/connect, a standard wallet from a button", () => {
  it("connects the wallet, then makes it current", async () => {
    const wallet = phantom(false);
    wallets.list = [wallet];

    await makeStandardCurrent("Phantom");

    expect(wallet.connect).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({
      state: "sol",
      standardName: "Phantom",
    });
  });

  it("makes a wallet already connected as a payer current without dropping it", async () => {
    const wallet = phantom(true);
    wallets.list = [wallet];

    await makeStandardCurrent("Phantom");

    expect(wallet.connect).not.toHaveBeenCalled();
    expect(wallet.disconnect).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      state: "sol",
      standardName: "Phantom",
    });
  });

  it("changes nothing when the wallet declines", async () => {
    const wallet = phantom(false);
    wallet.connect.mockRejectedValue(new Error("User rejected the request."));
    wallets.list = [wallet];

    await expect(makeStandardCurrent("Phantom")).rejects.toThrow(
      "User rejected"
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("disconnects the wallet and brings the Playground wallet back", async () => {
    const wallet = phantom(true);
    wallets.list = [wallet];

    await disconnectStandard("Phantom");

    expect(wallet.disconnect).toHaveBeenCalledOnce();
    // eslint-disable-next-line unicorn/no-null -- `standardName` is `null` with no standard wallet current
    expect(update).toHaveBeenCalledWith({ state: "pg", standardName: null });
  });

  it("refuses a wallet that is not installed", async () => {
    wallets.list = [];

    await expect(makeStandardCurrent("Phantom")).rejects.toThrow(
      "Phantom is not installed in this browser."
    );
  });
});
