import { afterEach, describe, expect, it, vi } from "vitest";

import { PgConnection } from "./connection";
import { PgSettings } from "./settings";

// The real settings module reads build-time globals the unit runner lacks
vi.mock("./settings", () => ({
  PgSettings: { connection: { endpoint: "http://localhost:8899" } },
}));

// Playnet pulls in the WASM packages; only its URL check is read here
vi.mock("./playnet", () => ({
  OverridableConnection: class {},
  PgPlaynet: { isUrlPlaynet: (url: string) => url === "http://playnet" },
}));

describe("PgConnection.getCluster", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Localnet and Surfpool (default `127.0.0.1:8899`) are the local deploy
  // path: read from the URL alone, never by asking the validator
  it.each([
    "http://localhost:8899",
    "http://127.0.0.1:8899",
    "http://127.0.0.1:18899",
  ])("reads %s as localnet without an RPC call", async (endpoint) => {
    const create = vi.spyOn(PgConnection, "create");

    await expect(PgConnection.getCluster(endpoint)).resolves.toBe("localnet");
    expect(create).not.toHaveBeenCalled();
  });

  it("reads the public devnet URL as devnet, not localnet", async () => {
    await expect(
      PgConnection.getCluster("https://api.devnet.solana.com")
    ).resolves.toBe("devnet");
  });

  // A remote host that only spells "localhost" must not open the local
  // path's sign-in-free airdrop; it is decided by its genesis hash
  it.each([
    "https://localhost.example.com",
    "https://rpc.example.com/?proxy=127.0.0.1",
  ])("does not read %s as localnet", async (endpoint) => {
    const getGenesisHash = vi.fn(async () => "unknown-genesis");
    vi.spyOn(PgConnection, "create").mockReturnValue({
      getGenesisHash,
    } as never);

    await expect(PgConnection.getCluster(endpoint)).rejects.toThrow(
      "did not match any cluster"
    );
    expect(getGenesisHash).toHaveBeenCalledOnce();
  });
});

describe("PgConnection.clusterIsStale", () => {
  // `cluster` lags the endpoint by a genesis-hash round trip on a custom RPC,
  // and a faucet decision taken in between would use the old network's name
  it("is true from the endpoint's change until its cluster is read", async () => {
    await PgConnection.readCluster();
    expect(PgConnection.clusterIsStale).toBe(false);

    PgSettings.connection.endpoint = "http://127.0.0.1:18899";
    expect(PgConnection.clusterIsStale).toBe(true);

    await PgConnection.readCluster();
    expect(PgConnection.clusterIsStale).toBe(false);
  });

  // Two networks picked in a row: the first, slow one may answer last, and
  // its answer is what `cluster` would keep
  it.each(["answers", "fails"])(
    "takes the selected endpoint's cluster when an older read %s last",
    async (ending) => {
      const answers = new Map<
        string,
        { resolve: (c: "devnet") => void; reject: (e: Error) => void }
      >();
      const getCluster = vi
        .spyOn(PgConnection, "getCluster")
        .mockImplementation((endpoint) =>
          endpoint === "http://slow"
            ? new Promise((resolve, reject) => {
                answers.set("http://slow", { resolve, reject });
              })
            : Promise.resolve("devnet")
        );

      PgSettings.connection.endpoint = "http://slow";
      const older = PgConnection.readCluster();
      PgSettings.connection.endpoint = "http://fast";
      await expect(PgConnection.readCluster()).resolves.toBe("devnet");

      const slow = answers.get("http://slow");
      if (ending === "fails") slow?.reject(new Error("timed out"));
      else slow?.resolve("devnet");

      await expect(older).resolves.toBe("devnet");
      expect(getCluster).toHaveBeenLastCalledWith("http://fast");
      expect(PgConnection.clusterIsStale).toBe(false);
      getCluster.mockRestore();
    }
  );
});
