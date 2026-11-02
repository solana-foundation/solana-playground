import { describe, expect, it, vi } from "vitest";

import { PgConnection, PgTerminal } from "../../utils";
import { deploy } from "./deploy";
import { MAINNET_DEPLOY_WARNING } from "./mainnet-warning";

// Only what `deploy.handle` touches before `processDeploy`; the deploy itself
// then fails on the missing program, and the tests read what it printed first
vi.mock("../../utils", () => ({
  PgCommon: {},
  PgConnection: { cluster: null, current: {} },
  PgGlobal: { deployState: "ready", update: vi.fn() },
  PgProgramInfo: {},
  PgServer: {},
  PgTerminal: {
    println: vi.fn(),
    info: (text: string) => text,
    success: (text: string) => text,
    warning: (text: string) => text,
  },
  PgTx: {},
  PgView: { setMainSecondaryProgress: vi.fn() },
  PgWallet: {},
  PgWeb3: {},
}));

/** Every line `deploy` printed, in order */
const printed = () =>
  vi.mocked(PgTerminal.println).mock.calls.map(([line]) => String(line));

const runOn = async (cluster: string | null) => {
  vi.mocked(PgTerminal.println).mockClear();
  Object.defineProperty(PgConnection, "cluster", {
    value: cluster,
    configurable: true,
  });
  if (!deploy.handle) throw new Error("deploy has no handler");
  await deploy.handle({} as never).catch(() => {
    // `processDeploy` has nothing to deploy here; the lines before it are
    // what these tests read
  });
};

describe("deploy", () => {
  it("warns before Deploying... on mainnet-beta", async () => {
    await runOn("mainnet-beta");

    const lines = printed();
    const warning = lines.indexOf(MAINNET_DEPLOY_WARNING);
    const deploying = lines.findIndex((l) => l.startsWith("Deploying..."));
    expect(warning).toBeGreaterThanOrEqual(0);
    expect(warning).toBeLessThan(deploying);
  });

  it.each(["devnet", null])("does not warn on %s", async (cluster) => {
    await runOn(cluster);

    expect(printed()).not.toContain(MAINNET_DEPLOY_WARNING);
    expect(printed().some((l) => l.startsWith("Deploying..."))).toBe(true);
  });
});
