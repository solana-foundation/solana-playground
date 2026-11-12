// Which short wallet "Send from your wallet" may fund
import { afterEach, describe, expect, it, vi } from "vitest";

const PG = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const FIRST = "4Zr8aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789Mn3Q";
const EXTENSION = "7Hq5aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789Xk2P";

const utils = vi.hoisted(() => ({
  PgWallet: {
    current: undefined as unknown,
    accounts: [{ name: "Wallet 1", kp: [] }] as unknown[],
    create: () => ({ publicKey: { toBase58: () => FIRST } }),
  },
}));
vi.mock("@/utils", () => utils);

import { onDidRequestFundDialog } from "./open";
import { fundFor } from "./receiver";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

const wallet = (isPg: boolean, address: string) => ({
  isPg,
  name: isPg ? "Wallet 2" : "Phantom",
  publicKey: { toBase58: () => address },
});

describe("features/fund-wallet/model/receiver fundFor", () => {
  it("opens the dialog for the current Playground wallet", () => {
    const asked: string[] = [];
    stop = onDidRequestFundDialog((from) => asked.push(from));
    utils.PgWallet.current = wallet(true, PG);

    fundFor("deploy-card")(PG)?.();

    expect(asked).toEqual(["deploy-card"]);
  });

  it("offers nothing for a wallet the dialog would not fund", () => {
    stop = onDidRequestFundDialog(() => undefined);
    utils.PgWallet.current = wallet(true, PG);

    expect(fundFor("deploy-card")(FIRST)).toBeUndefined();
  });

  it("offers nothing for an extension, whose receiver is the first account", () => {
    stop = onDidRequestFundDialog(() => undefined);
    utils.PgWallet.current = wallet(false, EXTENSION);

    expect(fundFor("tutorial-card")(EXTENSION)).toBeUndefined();
    expect(fundFor("tutorial-card")(FIRST)).toBeTypeOf("function");
  });
});
