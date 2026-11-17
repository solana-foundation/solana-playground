import { BLOCK_EXPLORERS } from "../block-explorers";
import { orb } from "../block-explorers/orb";
import { solanaExplorer } from "../block-explorers/solana-explorer";
import { solscan } from "../block-explorers/solscan";
import {
  DEFAULT_BLOCK_EXPLORER,
  findBlockExplorer,
  PgBlockExplorer,
  resolveBlockExplorer,
} from "./block-explorer";
import { PgSettings } from "./settings";

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

// What `resolveBlockExplorer` stores, without the app's settings behind it
vi.mock("./settings", () => ({
  PgSettings: {
    blockExplorer: { name: "" },
    onDidChangeBlockExplorerName: vi.fn(),
  },
}));

const ID = "11111111111111111111111111111111";

describe("block explorers", () => {
  it("open the network they are given, not the one picked now", () => {
    expect(solanaExplorer.getAddressUrl(ID, "devnet")).toBe(
      `https://explorer.solana.com/address/${ID}?cluster=devnet`
    );
    expect(solscan.getTxUrl("sig", "devnet")).toBe(
      "https://solscan.io/tx/sig?cluster=devnet"
    );
    expect(solscan.getAddressUrl(ID, "mainnet")).toBe(
      `https://solscan.io/address/${ID}`
    );
  });

  it("open Orb on the network they are given", () => {
    // Orb's scheme, checked on orbmarkets.io on 13 Nov 2026: mainnet takes no
    // parameter; devnet and testnet take `?cluster=`
    expect(orb.getAddressUrl(ID, "mainnet")).toBe(
      `https://orbmarkets.io/address/${ID}`
    );
    expect(orb.getTxUrl("sig", "mainnet")).toBe("https://orbmarkets.io/tx/sig");
    expect(orb.getAddressUrl(ID, "devnet")).toBe(
      `https://orbmarkets.io/address/${ID}?cluster=devnet`
    );
    expect(orb.getTxUrl("sig", "devnet")).toBe(
      "https://orbmarkets.io/tx/sig?cluster=devnet"
    );
    expect(orb.getTxUrl("sig", "testnet")).toBe(
      "https://orbmarkets.io/tx/sig?cluster=testnet"
    );
    // Given no network, the selected one (testnet here)
    expect(orb.getAddressUrl(ID)).toBe(
      `https://orbmarkets.io/address/${ID}?cluster=testnet`
    );
  });

  it("are Solana Explorer, Solscan and Orb, Solana Explorer by default", () => {
    // The designed order: the default first, Solscan, then Orb (HOO-2759)
    expect(BLOCK_EXPLORERS.map((be) => be.name)).toEqual([
      "Solana Explorer",
      "Solscan",
      "Orb",
    ]);
    expect(DEFAULT_BLOCK_EXPLORER).toBe("Solana Explorer");
  });

  it("open a program's IDL with the network after the path", () => {
    expect(solanaExplorer.getIdlUrl(ID, "devnet")).toBe(
      `https://explorer.solana.com/address/${ID}/idl?cluster=devnet`
    );
    expect(solanaExplorer.getIdlUrl(ID, "mainnet")).toBe(
      `https://explorer.solana.com/address/${ID}/idl`
    );
    // Orb names its IDL tab `anchor-idl`
    expect(orb.getIdlUrl(ID, "devnet")).toBe(
      `https://orbmarkets.io/address/${ID}/anchor-idl?cluster=devnet`
    );
    expect(orb.getIdlUrl(ID, "mainnet")).toBe(
      `https://orbmarkets.io/address/${ID}/anchor-idl`
    );
  });

  it("say Orb cannot open a local validator or a custom RPC", () => {
    expect(orb.opens("mainnet")).toBe(true);
    expect(orb.opens("devnet")).toBe(true);
    expect(orb.opens("testnet")).toBe(true);
    expect(orb.opens("localnet")).toBe(false);
    // `null` is a network with no cluster (a custom RPC), not the selected one
    // eslint-disable-next-line unicorn/no-null -- the explorer API's own value for it
    expect(orb.opens(null)).toBe(false);
    // eslint-disable-next-line unicorn/no-null -- the explorer API's own value for it
    expect(orb.getTxUrl("sig", null)).toBe("https://orbmarkets.io/tx/sig");
  });

  it("say which networks they can open", () => {
    expect(solanaExplorer.opens("devnet")).toBe(true);
    expect(solanaExplorer.opens("mainnet")).toBe(true);
    expect(solscan.opens("localnet")).toBe(false);
  });

  it("fall back to Solana Explorer when the stored one is no longer offered", () => {
    const all = [solscan, solanaExplorer];
    expect(findBlockExplorer(all, "Solscan")).toBe(solscan);
    // Solana FM was dropped (HOO-2700); a user who had it picked keeps working
    expect(findBlockExplorer(all, "Solana FM")).toBe(solanaExplorer);
    expect(() => findBlockExplorer([solscan], "Solana FM")).toThrow(
      "Solana Explorer"
    );
  });

  it("store the fallback, so the settings page shows what links open", () => {
    PgBlockExplorer.all = [solscan, solanaExplorer];
    const writes: string[] = [];
    Object.defineProperty(PgSettings.blockExplorer, "name", {
      configurable: true,
      get: () => "",
      set: (name: string) => writes.push(name),
    });

    expect(resolveBlockExplorer("Solana FM")).toBe(solanaExplorer);
    expect(writes).toEqual(["Solana Explorer"]);

    // An offered name is stored already; writing it would only fire again
    expect(resolveBlockExplorer("Solscan")).toBe(solscan);
    expect(resolveBlockExplorer("Solana Explorer")).toBe(solanaExplorer);
    expect(writes).toEqual(["Solana Explorer"]);
  });

  it("open the selected network when given none", () => {
    expect(solanaExplorer.getTxUrl("sig")).toBe(
      "https://explorer.solana.com/tx/sig?cluster=testnet"
    );
  });
});
