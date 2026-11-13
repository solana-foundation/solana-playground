import { beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_ENDPOINT } from "@/test-utils/endpoints.mjs";

import { PgTx } from "../../utils";
import { BpfLoaderUpgradeable } from "./bpf-loader-upgradeable";

const BYTES = new Uint8Array([1, 2, 3]);

/** A connection that answers what the loader reads, and nothing else */
const connectionTo = (rpcEndpoint: string) => ({
  rpcEndpoint,
  commitment: "confirmed",
  getMinimumBalanceForRentExemption: vi.fn(async () => 1),
  // The first read finds an empty buffer, every later one the written bytes
  getAccountInfo: (() => {
    let reads = 0;
    return async () => ({
      data: reads++ === 0 ? Buffer.alloc(BYTES.length) : Buffer.from(BYTES),
    });
  })(),
});

const selected = connectionTo(TEST_ENDPOINT.DEVNET);

vi.mock("../../utils", () => {
  const pk = { toBase58: () => "pk" };
  return {
    PgCommon: {
      setDefault: (opts: object | undefined, defaults: object) =>
        Object.assign({}, defaults, opts),
      sleep: async () => {},
      tryUntilSuccess: async (fn: () => Promise<unknown>) => await fn(),
    },
    PgConnection: {
      get current() {
        return selected;
      },
      getReadBufferConnection: <T>(connection: T) => connection,
      getSendTxPerSecond: () => undefined,
    },
    PgPlaynet: { isUrlPlaynet: () => false },
    PgTx: {
      send: vi.fn(async () => "sig"),
      simulate: vi.fn(async () => ({ unitsConsumed: 1 })),
      // eslint-disable-next-line unicorn/no-null -- an RPC confirmation's `err` is `null` on success
      confirm: vi.fn(async () => ({ err: null })),
    },
    PgWallet: { current: { publicKey: pk } },
    PgWeb3: {
      PACKET_DATA_SIZE: 1232,
      DEFAULT_MS_PER_SLOT: 1,
      SystemProgram: { createAccount: () => "create" },
      BpfLoaderUpgradeableProgram: {
        BUFFER_METADATA_SIZE: 0,
        PROGRAM_ACCOUNT_SIZE: 36,
        getBufferAccountSize: (n: number) => n,
        initializeBuffer: () => "init",
        setBufferAuthority: () => "authority",
        write: () => "write",
        close: () => "close",
        deployWithMaxProgramLen: () => "deploy",
        extendProgram: () => "extend",
        upgrade: () => "upgrade",
      },
    },
  };
});
// The loader's writes go through a connection it builds to the same RPC
vi.mock("@/entities/cluster", () => ({
  getUnretriedConnectionFor: () => (endpoint: string) => ({
    rpcEndpoint: endpoint,
  }),
}));

const pk = { toBase58: () => "buffer" } as never;
const signer = { publicKey: pk } as never;

/** Every connection the loader's sends, simulations and confirmations took */
const connectionsUsed = () =>
  ([] as unknown[][])
    .concat(
      vi.mocked(PgTx.send).mock.calls,
      vi.mocked(PgTx.simulate).mock.calls,
      vi.mocked(PgTx.confirm).mock.calls
    )
    .map(([, opts]) => (opts as { connection?: unknown }).connection);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BpfLoaderUpgradeable", () => {
  const theDeploys = connectionTo(TEST_ENDPOINT.TESTNET);

  it.each([
    [
      "createBuffer",
      () =>
        BpfLoaderUpgradeable.createBuffer(signer, 1, 3, {
          connection: theDeploys as never,
        }),
    ],
    [
      "setBufferAuthority",
      () =>
        BpfLoaderUpgradeable.setBufferAuthority(pk, pk, {
          connection: theDeploys as never,
        }),
    ],
    [
      "closeBuffer",
      () =>
        BpfLoaderUpgradeable.closeBuffer(pk, {
          connection: theDeploys as never,
        }),
    ],
    [
      "extendProgram",
      () =>
        BpfLoaderUpgradeable.extendProgram(pk, 10, {
          connection: theDeploys as never,
        }),
    ],
    [
      "upgradeProgram",
      () =>
        BpfLoaderUpgradeable.upgradeProgram(pk, pk, {
          connection: theDeploys as never,
        }),
    ],
    [
      "loadBuffer",
      () =>
        BpfLoaderUpgradeable.loadBuffer(pk, BYTES, {
          connection: theDeploys as never,
        }),
    ],
  ] as const)(
    "sends %s to the RPC of the connection it is given, not the selected one",
    async (_, call) => {
      await call();

      const used = connectionsUsed() as { rpcEndpoint: string }[];
      expect(used.length).toBeGreaterThan(0);
      expect(used.every((c) => c.rpcEndpoint === theDeploys.rpcEndpoint)).toBe(
        true
      );
    }
  );

  it("reads the rent and sends deployProgram on the connection it is given", async () => {
    await BpfLoaderUpgradeable.deployProgram(signer, pk, 3, {
      connection: theDeploys as never,
    });

    expect(theDeploys.getMinimumBalanceForRentExemption).toHaveBeenCalled();
    expect(selected.getMinimumBalanceForRentExemption).not.toHaveBeenCalled();
    expect(connectionsUsed()).toEqual([theDeploys]);
  });

  it("sends on the selected connection when given none", async () => {
    await BpfLoaderUpgradeable.closeBuffer(pk);

    expect(connectionsUsed()).toEqual([selected]);
  });
});
