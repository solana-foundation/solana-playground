import { solanaExplorer } from "../block-explorers/solana-explorer";
import { solanaFM } from "../block-explorers/solana-fm";
import { solscan } from "../block-explorers/solscan";

// `settings.ts`, reached through this module, reads a global
// that only exists once the app has booted
vi.hoisted(() => {
  vi.stubGlobal("GLOBAL_SETTINGS", { default: {} });
});

// Testnet is the selected network; every record below is from elsewhere
// (each explorer imports the `utils` barrel, `./index` from here)
vi.mock("./index", async () => ({
  PgBlockExplorer: (await import("./block-explorer")).PgBlockExplorer,
  PgConnection: { cluster: "testnet" },
}));

const ID = "11111111111111111111111111111111";

describe("block explorers", () => {
  it("open the network they are given, not the one picked now", () => {
    expect(solanaExplorer.getAddressUrl(ID, "devnet")).toBe(
      `https://explorer.solana.com/address/${ID}?cluster=devnet`
    );
    expect(solanaFM.getTxUrl("sig", "devnet")).toBe(
      "https://solana.fm/tx/sig?cluster=devnet-solana"
    );
    expect(solscan.getAddressUrl(ID, "mainnet-beta")).toBe(
      `https://solscan.io/address/${ID}`
    );
  });

  it("say which networks they can open", () => {
    expect(solanaExplorer.opens("devnet")).toBe(true);
    expect(solanaExplorer.opens("mainnet-beta")).toBe(true);
    expect(solscan.opens("localnet")).toBe(false);
    expect(solanaExplorer.opens("playnet")).toBe(false);
  });

  it("open the selected network when given none", () => {
    expect(solanaExplorer.getTxUrl("sig")).toBe(
      "https://explorer.solana.com/tx/sig?cluster=testnet"
    );
  });
});
