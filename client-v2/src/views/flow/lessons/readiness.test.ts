import { readiness, readinessLine } from "./readiness";
import type { ReadinessEnv } from "./readiness";
import type { VerifyCondition } from "./types";

const DEPLOYED: VerifyCondition = { kind: "deployed" };

/** Everything a deploy needs, in place */
const READY: ReadinessEnv = {
  build: "done",
  built: true,
  lastBuildFailed: false,
  wallet: true,
  balance: 2.5,
  cluster: "devnet",
  signedIn: true,
};

const blockers = (env: Partial<ReadinessEnv>, c: VerifyCondition = DEPLOYED) =>
  readiness(c, { ...READY, ...env });

const kinds = (env: Partial<ReadinessEnv>, c: VerifyCondition = DEPLOYED) =>
  blockers(env, c).map((b) => b.kind);

describe("readiness", () => {
  it("has nothing to say when a deploy can go ahead", () => {
    expect(readiness(DEPLOYED, READY)).toEqual([]);
  });

  it("names what is missing, in the order to fix it", () => {
    expect(
      kinds({
        build: "upcoming",
        built: false,
        wallet: false,
        cluster: "localnet",
      })
    ).toEqual(["needs-build", "needs-wallet", "needs-cluster"]);
  });

  it("puts the cluster before the SOL, since an airdrop needs the right one", () => {
    expect(kinds({ cluster: "testnet", balance: 0 })).toEqual([
      "needs-cluster",
      "needs-sol",
    ]);
  });

  it("asks for a build whenever no build has landed, however it failed", () => {
    for (const build of ["upcoming", "failed", "running"] as const) {
      expect(kinds({ build, built: false })).toEqual(["needs-build"]);
    }
  });

  it("says a build is running rather than offering to start another", () => {
    expect(blockers({ build: "running", built: false })).toEqual([
      { kind: "needs-build", running: true },
    ]);
    expect(blockers({ build: "failed", built: false })).toEqual([
      { kind: "needs-build", running: false },
    ]);
  });

  it("says a deploy would upload the previous build after a failure", () => {
    // `checkProgram` in `commands/deploy/deploy.ts` warns that the server
    // kept the last successful binary and asks whether to deploy it
    // anyway, defaulting to no. A learner who never sees that prompt
    // would otherwise prove the step with code that is not theirs.
    expect(blockers({ lastBuildFailed: true })).toEqual([
      { kind: "needs-rebuild" },
    ]);
  });

  it("asks for a first build rather than a rebuild when there is none", () => {
    // Nothing was ever built, so "the last build failed" would be a
    // confusing way to say "there is no build"
    expect(
      kinds({ build: "failed", built: false, lastBuildFailed: true })
    ).toEqual(["needs-build"]);
  });

  it("does not ask for a build a reload only forgot", () => {
    // `PgFlow` is memory-only and starts over at `upcoming`; the program's
    // build-server uuid is on disk, so the deploy would in fact succeed
    expect(kinds({ build: "upcoming", built: true })).toEqual([]);
  });

  it("names an empty wallet, with sign-in first when the airdrop needs it", () => {
    expect(blockers({ balance: 0 })).toEqual([
      { kind: "needs-sol", signedIn: true },
    ]);
    expect(blockers({ balance: 0, signedIn: false })).toEqual([
      { kind: "needs-sol", signedIn: false },
    ]);
  });

  it("does not guess about a balance it does not know", () => {
    expect(kinds({ balance: null })).toEqual([]);
    // Low but non-zero: the deploy command itself asks about an airdrop
    // with the real cost in hand, so the band does not second-guess it
    expect(kinds({ balance: 0.3 })).toEqual([]);
  });

  it("does not guess about a cluster it does not know either", () => {
    // A custom RPC whose genesis hash has not come back reads as `null`.
    // Telling a learner already on devnet to switch to devnet is worse
    // than saying nothing.
    expect(kinds({ cluster: null })).toEqual([]);
  });

  it("names the cluster it found, whichever it is", () => {
    expect(blockers({ cluster: "playnet" })).toEqual([
      { kind: "needs-cluster", cluster: "playnet" },
    ]);
    expect(blockers({ cluster: "mainnet-beta" })).toEqual([
      { kind: "needs-cluster", cluster: "mainnet-beta" },
    ]);
  });

  it("does not ask about SOL when there is no wallet to hold it", () => {
    expect(kinds({ wallet: false, balance: 0 })).toEqual(["needs-wallet"]);
  });

  it("has no preconditions for a build or a reading", () => {
    const bare: ReadinessEnv = {
      build: "upcoming",
      built: false,
      lastBuildFailed: true,
      wallet: false,
      balance: 0,
      cluster: null,
      signedIn: false,
    };
    expect(readiness({ kind: "build-passes" }, bare)).toEqual([]);
    expect(readiness({ kind: "idl", instruction: "hello" }, bare)).toEqual([]);
    expect(readiness({ kind: "read", at: "interact" }, bare)).toEqual([]);
  });
});

describe("readinessLine", () => {
  it("is null when nothing is missing", () => {
    expect(readinessLine(DEPLOYED, [])).toBeNull();
  });

  it("names the action it is explaining, from the condition", () => {
    const line = readinessLine(DEPLOYED, [{ kind: "needs-wallet" }]);
    expect(line?.lead).toBe("Before you can deploy:");

    const building = readinessLine({ kind: "build-passes" }, [
      { kind: "needs-wallet" },
    ]);
    expect(building?.lead).toBe("Before you can build:");
  });

  it("names a stale binary as the risk it is", () => {
    expect(
      readinessLine(DEPLOYED, [{ kind: "needs-rebuild" }])?.items[0].text
    ).toBe("build again -- the last build failed");
  });

  it("says what stands in the way, each with its remedy", () => {
    const line = readinessLine(DEPLOYED, [
      { kind: "needs-build", running: false },
      { kind: "needs-wallet" },
      { kind: "needs-cluster", cluster: "localnet" },
      { kind: "needs-sol", signedIn: false },
    ]);
    expect(line?.items.map((i) => i.text)).toEqual([
      "build first",
      "connect a wallet",
      "switch from localnet to devnet",
      "sign in, then airdrop -- the wallet holds no SOL",
    ]);
    expect(line?.items.every((i) => i.actionable)).toBe(true);
  });

  it("offers nothing to click while a build is already running", () => {
    const line = readinessLine(DEPLOYED, [
      { kind: "needs-build", running: true },
    ]);
    expect(line?.items[0]).toMatchObject({
      text: "building...",
      actionable: false,
    });
  });

  it("drops the sign-in half of the chain once the learner is signed in", () => {
    expect(
      readinessLine(DEPLOYED, [{ kind: "needs-sol", signedIn: true }])?.items[0]
        .text
    ).toBe("airdrop -- the wallet holds no SOL");
  });
});
