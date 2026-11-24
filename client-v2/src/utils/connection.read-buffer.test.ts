// A file of its own: it mocks `./settings`, which needs the build's globals
import { afterEach, describe, expect, it, vi } from "vitest";

import { Endpoint } from "@/entities/cluster/model/endpoint";

vi.mock("./settings", async () => ({
  PgSettings: {
    connection: {
      endpoint: (await import("@/entities/cluster/model/endpoint")).Endpoint
        .DEVNET,
    },
    onDidChangeConnectionEndpoint: () => ({ dispose: () => undefined }),
    onDidChangeConnectionCommitment: () => ({ dispose: () => undefined }),
  },
}));

const READ_BUFFER = "https://read-buffer.test/";

/** `PgConnection` with the read-buffer variables as `env` sets them */
const pgConnectionWith = async (env: Record<string, string | undefined>) => {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  const { PgConnection } = await import("./connection");
  const { getConnectionFor } = await import("@/entities/cluster");
  return {
    PgConnection,
    connectionTo: getConnectionFor("finalized"),
  };
};

describe("utils/connection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    {
      cluster: "devnet",
      variable: "REACT_APP_DEVNET_READ_BUFFER_RPC_URL",
      endpoint: Endpoint.DEVNET,
    },
    {
      cluster: "mainnet",
      variable: "REACT_APP_MAINNET_READ_BUFFER_RPC_URL",
      endpoint: Endpoint.MAINNET,
    },
  ])(
    "reads $cluster buffers through its read-buffer RPC, at the selected commitment",
    async ({ variable, endpoint }) => {
      const { PgConnection, connectionTo } = await pgConnectionWith({
        [variable]: READ_BUFFER,
      });

      const read = PgConnection.getReadBufferConnection(connectionTo(endpoint));

      expect(read.rpcEndpoint).toBe(READ_BUFFER);
      expect(read.commitment).toBe("finalized");
    }
  );

  it.each([
    {
      label: "the cluster has no read-buffer RPC",
      env: { REACT_APP_DEVNET_READ_BUFFER_RPC_URL: READ_BUFFER },
      endpoint: Endpoint.TESTNET,
    },
    {
      label: "the cluster's read-buffer RPC is empty",
      env: { REACT_APP_DEVNET_READ_BUFFER_RPC_URL: "" },
      endpoint: Endpoint.DEVNET,
    },
    {
      label: "a custom endpoint is not the selected one",
      env: { REACT_APP_DEVNET_READ_BUFFER_RPC_URL: READ_BUFFER },
      endpoint: "https://custom.test",
    },
  ])(
    "reads through the selected connection when $label",
    async ({ env, endpoint }) => {
      const { PgConnection, connectionTo } = await pgConnectionWith(env);
      const selected = connectionTo(endpoint);

      expect(PgConnection.getReadBufferConnection(selected)).toBe(selected);
    }
  );

  it("names the Testnet RPC the env configures testnet without a request", async () => {
    const platformTestnet = "https://testnet.rpc.test/?api-key=k";
    const { PgConnection } = await pgConnectionWith({
      REACT_APP_TESTNET_RPC_URL: platformTestnet,
    });

    await expect(PgConnection.getCluster(platformTestnet)).resolves.toBe(
      "testnet"
    );
  });

  describe("a selected custom endpoint, whose cluster came from its genesis hash", () => {
    const CUSTOM = "https://custom.test";

    /** `PgConnection` with `CUSTOM` selected, resolved to devnet, `stale` until read again */
    const customOnDevnetWith =
      (stale: boolean) => async (env: Record<string, string>) => {
        const loaded = await pgConnectionWith(env);
        const { PgSettings } = await import("./settings");
        PgSettings.connection.endpoint = CUSTOM;
        Object.defineProperty(loaded.PgConnection, "cluster", {
          value: "devnet",
          configurable: true,
        });
        Object.defineProperty(loaded.PgConnection, "clusterIsStale", {
          value: stale,
          configurable: true,
        });
        return loaded;
      };

    it("reads its buffers through that cluster's read-buffer RPC", async () => {
      const { PgConnection, connectionTo } = await customOnDevnetWith(false)({
        REACT_APP_DEVNET_READ_BUFFER_RPC_URL: READ_BUFFER,
      });

      expect(
        PgConnection.getReadBufferConnection(connectionTo(CUSTOM)).rpcEndpoint
      ).toBe(READ_BUFFER);
    });

    it("caps its sends by that cluster's send cap", async () => {
      const { PgConnection, connectionTo } = await customOnDevnetWith(false)({
        REACT_APP_DEVNET_SEND_TX_PER_SECOND: "5",
      });

      expect(PgConnection.getSendTxPerSecond(connectionTo(CUSTOM))).toBe(5);
    });

    it("ignores a cluster still the previous endpoint's", async () => {
      const { PgConnection, connectionTo } = await customOnDevnetWith(true)({
        REACT_APP_DEVNET_READ_BUFFER_RPC_URL: READ_BUFFER,
      });
      const selected = connectionTo(CUSTOM);

      expect(PgConnection.getReadBufferConnection(selected)).toBe(selected);
    });
  });

  it.each([
    {
      variable: "REACT_APP_DEVNET_SEND_TX_PER_SECOND",
      endpoint: Endpoint.DEVNET,
      value: "5",
      perSecond: 5,
    },
    {
      variable: "REACT_APP_MAINNET_SEND_TX_PER_SECOND",
      endpoint: Endpoint.MAINNET,
      value: "0.5",
      perSecond: 0.5,
    },
  ])(
    "caps sends at $value per second from $variable",
    async ({ variable, endpoint, value, perSecond }) => {
      const { PgConnection, connectionTo } = await pgConnectionWith({
        [variable]: value,
      });

      expect(PgConnection.getSendTxPerSecond(connectionTo(endpoint))).toBe(
        perSecond
      );
    }
  );

  it.each([
    {
      label: "the cluster's send cap is unset",
      value: "5",
      endpoint: Endpoint.TESTNET,
    },
    { label: "the send cap is 0", value: "0", endpoint: Endpoint.DEVNET },
  ])("caps sends at 4 per second when $label", async ({ value, endpoint }) => {
    const { PgConnection, connectionTo } = await pgConnectionWith({
      REACT_APP_DEVNET_SEND_TX_PER_SECOND: value,
    });

    expect(PgConnection.getSendTxPerSecond(connectionTo(endpoint))).toBe(4);
  });

  it.each([
    { label: "the cluster is Localnet", endpoint: Endpoint.LOCALNET },
    {
      label: "a custom endpoint is not the selected one",
      endpoint: "https://custom.test",
    },
  ])("caps no sends when $label", async ({ endpoint }) => {
    const { PgConnection, connectionTo } = await pgConnectionWith({
      REACT_APP_DEVNET_SEND_TX_PER_SECOND: "5",
    });

    expect(
      PgConnection.getSendTxPerSecond(connectionTo(endpoint))
    ).toBeUndefined();
  });
});

describe("utils/connection: getAirdropConnection", () => {
  const PLATFORM = "https://devnet.platform.test/?api-key=k";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("airdrops on the platform RPC's cluster through its native RPC, at the selected commitment", async () => {
    const { PgConnection, connectionTo } = await pgConnectionWith({
      REACT_APP_DEVNET_RPC_URL: PLATFORM,
      REACT_APP_DEVNET_READ_BUFFER_RPC_URL: Endpoint.DEVNET,
    });

    const airdrop = PgConnection.getAirdropConnection(connectionTo(PLATFORM));

    expect(airdrop.rpcEndpoint).toBe(Endpoint.DEVNET);
    expect(airdrop.commitment).toBe("finalized");
  });

  it.each([
    {
      label: "the env sets no native RPC for the cluster",
      env: { REACT_APP_DEVNET_RPC_URL: PLATFORM },
      endpoint: PLATFORM,
    },
    {
      label: "the endpoint is Localnet",
      env: { REACT_APP_DEVNET_READ_BUFFER_RPC_URL: Endpoint.DEVNET },
      endpoint: "http://localhost:8899",
    },
    {
      label: "a custom endpoint is not the selected one",
      env: { REACT_APP_DEVNET_READ_BUFFER_RPC_URL: Endpoint.DEVNET },
      endpoint: "https://custom.test",
    },
  ])(
    "airdrops through the selected connection when $label",
    async ({ env, endpoint }) => {
      const { PgConnection, connectionTo } = await pgConnectionWith(env);
      const selected = connectionTo(endpoint);

      expect(PgConnection.getAirdropConnection(selected)).toBe(selected);
    }
  );
});
