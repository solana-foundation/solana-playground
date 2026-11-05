import { beforeEach, describe, expect, it, vi } from "vitest";

import { PgConnection, PgView } from "../../utils";

let ran: Promise<void> = Promise.resolve();

// `batchChanges` runs its callback once, as on the first connection change
vi.mock("../../utils", () => ({
  PgCommon: {
    batchChanges: (cb: () => Promise<void>) => {
      ran = cb();
      return { dispose: () => undefined };
    },
  },
  PgConnection: {
    cluster: "localnet",
    isConnected: false,
    isClusterDown: false,
  },
  PgView: { setModal: vi.fn(async () => undefined) },
  PgWallet: { current: { publicKey: "wallet" } },
}));
vi.mock("./Local", () => ({ Local: "Local" }));

/** The effect's first pass on `cluster`, with the connection's state */
const passOn = async (
  cluster: string,
  state: { isConnected: boolean; isClusterDown: boolean }
) => {
  Object.assign(PgConnection, {
    cluster,
    isConnected: state.isConnected,
    isClusterDown: state.isClusterDown,
  });
  // A fresh module each time: the help opens once per page load
  vi.resetModules();
  const { connection } = await import("./connection");
  connection();
  await ran;
};

describe("connection helper", () => {
  beforeEach(() => {
    vi.mocked(PgView.setModal).mockClear();
  });

  it("opens the Connect to Localnet help when the local validator does not answer", async () => {
    await passOn("localnet", { isConnected: false, isClusterDown: false });

    await vi.waitFor(() =>
      expect(PgView.setModal).toHaveBeenCalledExactlyOnceWith("Local")
    );
  });

  it("opens the Connect to Localnet help when the local validator stalls", async () => {
    await passOn("localnet", { isConnected: true, isClusterDown: true });

    await vi.waitFor(() =>
      expect(PgView.setModal).toHaveBeenCalledExactlyOnceWith("Local")
    );
  });

  it("opens nothing while the local validator answers", async () => {
    await passOn("localnet", { isConnected: true, isClusterDown: false });

    expect(PgView.setModal).not.toHaveBeenCalled();
  });

  it("opens nothing for an unreachable devnet", async () => {
    await passOn("devnet", { isConnected: false, isClusterDown: false });

    expect(PgView.setModal).not.toHaveBeenCalled();
  });
});
