// What the assistant's deploy question is quoted from.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cluster: "devnet" as string | null,
  wallet: null as null | { isPg?: boolean },
}));

vi.mock("../../../../utils", () => ({
  PgBlockExplorer: {},
  PgCommand: {},
  PgConnection: {
    get cluster() {
      return mocks.cluster;
    },
  },
  PgExplorer: {},
  PgGlobal: {},
  PgProgramInfo: {},
  PgWallet: {
    get current() {
      return mocks.wallet;
    },
  },
}));
vi.mock("../../../../commands/deploy/estimate", () => ({
  estimateDeployCostWithin: async () => 1_420_000_000,
}));
vi.mock("../../../flow/lessons", () => ({ PgLesson: {} }));
vi.mock("./build-output", () => ({
  PgBuildOutput: {},
  stripKnownNoise: (s: string) => s,
}));
vi.mock("./lesson-context", () => ({ describeLesson: () => null }));

import { realBridge } from "./playground-bridge";

describe("realBridge.quoteDeploy", () => {
  beforeEach(() => {
    mocks.cluster = "devnet";
    mocks.wallet = null;
  });

  it.each([
    [
      "no wallet yet, so the Playground wallet will be made and pay",
      null,
      true,
    ],
    ["the Playground wallet", { isPg: true }, true],
    ["a connected wallet", { isPg: false }, false],
  ])("says the Playground wallet pays with %s", async (_, wallet, expected) => {
    mocks.wallet = wallet;
    expect((await realBridge.quoteDeploy()).playground).toBe(expected);
  });

  it.each([
    ["devnet", "devnet"],
    ["mainnet-beta", "mainnet"],
    [null, null],
  ])("names %s as %s", async (cluster, network) => {
    mocks.cluster = cluster;
    expect(await realBridge.quoteDeploy()).toEqual({
      network,
      cost: 1_420_000_000,
      playground: true,
    });
  });
});
