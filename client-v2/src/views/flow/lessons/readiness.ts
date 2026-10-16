import type { VerifyCondition } from "./types";
import { verifyingStage } from "./verify";
import type { StageStatus } from "../state/stage";

/**
 * Preconditions explain, they do not fail (the ledger spec).
 *
 * What a step's proving action needs before it can succeed, read off
 * state the client already holds. Pure and synchronous like `verify.ts`,
 * so the band can ask on every render. The action itself stays live --
 * a dead control in a demo is worse than a label that explains itself
 * -- and each blocker carries the remedy the band offers beside it.
 *
 * Nothing here guesses. A fact the client does not know yet (a balance
 * still loading, a cluster whose genesis hash has not come back) is
 * never read as a fact against the learner: telling somebody to switch
 * to devnet while they are already on devnet is worse than silence.
 */

export type Blocker =
  /** No successful build to deploy. `running` while one is in flight,
   * where there is nothing to click and nothing to fix -- only to wait */
  | { kind: "needs-build"; running: boolean }
  /**
   * A build exists, but the last one failed. The build server keeps the
   * previous binary, so a deploy now would upload code the learner did
   * not write -- and prove the step with it. `checkProgram` in
   * `commands/deploy/deploy.ts` asks about exactly this, in a terminal
   * prompt that defaults to no and that a collapsed console hides.
   */
  | { kind: "needs-rebuild" }
  /** No wallet to sign with */
  | { kind: "needs-wallet" }
  /** The lesson deploys to devnet and the client points somewhere else */
  | { kind: "needs-cluster"; cluster: string }
  /**
   * The wallet holds nothing. The devnet airdrop is behind GitHub
   * sign-in (#9), so the remedy is a chain when the learner is signed
   * out -- the explainer has to state all of it or it becomes the next
   * unlabelled click, one level down.
   */
  | { kind: "needs-sol"; signedIn: boolean };

export interface ReadinessEnv {
  /** The dev loop's build status, which is memory-only */
  build: StageStatus;
  /**
   * Whether a built program exists at all. Survives a reload, which
   * `build` does not: after one, `PgFlow` starts over at `upcoming`
   * while the program's build-server uuid is still on disk, and the
   * deploy that "needs a build" would in fact have succeeded.
   */
  built: boolean;
  /** Whether the most recent build attempt failed, which the build
   * server outlives: it still holds the last binary that compiled */
  lastBuildFailed: boolean;
  wallet: boolean;
  /** SOL, or `null` while unknown -- never guessed about */
  balance: number | null;
  /** The cluster's name (`devnet`, `localnet`, ...), or `null` while
   * unknown -- also never guessed about */
  cluster: string | null;
  signedIn: boolean;
}

/** The cluster every lesson path deploys to */
export const LESSON_CLUSTER = "devnet";

/**
 * @returns what stands between the learner and the step's proving
 * action, in the order to fix it; empty when nothing does
 */
export const readiness = (c: VerifyCondition, env: ReadinessEnv): Blocker[] => {
  switch (c.kind) {
    // A build is its own feedback -- a failed one says why in the
    // console -- and a reading has nothing to be ready for
    case "build-passes":
    case "idl":
    case "read":
      return [];

    case "deployed": {
      const blockers: Blocker[] = [];
      if (env.build !== "done" && !env.built) {
        blockers.push({
          kind: "needs-build",
          running: env.build === "running",
        });
      } else if (env.lastBuildFailed) {
        // Only once something has been built: with nothing to fall back
        // to, "the last build failed" is a confusing way to say "there
        // is no build", and the line above already says the plain thing
        blockers.push({ kind: "needs-rebuild" });
      }
      if (!env.wallet) blockers.push({ kind: "needs-wallet" });
      // Before the SOL question, because an airdrop on the wrong cluster
      // buys the learner nothing
      if (env.cluster !== null && env.cluster !== LESSON_CLUSTER) {
        blockers.push({ kind: "needs-cluster", cluster: env.cluster });
      }
      // Only a wallet known to be empty. A low balance is the deploy
      // command's call: it knows the real cost and already offers the
      // airdrop with that number in hand.
      if (env.wallet && env.balance === 0) {
        blockers.push({ kind: "needs-sol", signedIn: env.signedIn });
      }
      return blockers;
    }
  }
};

export interface ReadinessItem {
  blocker: Blocker;
  text: string;
  /** Whether there is anything to click. A build already running is a
   * thing to wait for, not a thing to start again */
  actionable: boolean;
}

/**
 * The explainer's copy: a lead naming the action being explained, and
 * one item per blocker with its remedy in the learner's words.
 *
 * @returns `null` when nothing is missing, so the band renders nothing
 * rather than an empty lead
 */
export const readinessLine = (
  c: VerifyCondition,
  blockers: Blocker[]
): { lead: string; items: ReadinessItem[] } | null => {
  if (!blockers.length) return null;

  // Derived from the condition rather than written down, so a blocker
  // on some later kind cannot inherit a lead about deploying
  const stage = verifyingStage(c);
  return {
    lead: `Before you can ${stage ?? "continue"}:`,
    items: blockers.map((blocker) => ({
      blocker,
      text: itemText(blocker),
      actionable: !(blocker.kind === "needs-build" && blocker.running),
    })),
  };
};

const itemText = (b: Blocker): string => {
  switch (b.kind) {
    case "needs-build":
      return b.running ? "building..." : "build first";
    case "needs-rebuild":
      return "build again -- the last build failed";
    case "needs-wallet":
      return "connect a wallet";
    case "needs-cluster":
      return `switch from ${b.cluster} to ${LESSON_CLUSTER}`;
    // The whole chain in one line: the airdrop is behind sign-in, and a
    // learner told only to "airdrop" would find that out by failing.
    // The links still arrive one at a time across blockers -- there is
    // no wallet to be empty until one is connected -- which is the
    // order the learner fixes them in anyway.
    case "needs-sol":
      return b.signedIn
        ? "airdrop -- the wallet holds no SOL"
        : "sign in, then airdrop -- the wallet holds no SOL";
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

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

  const blockers = (
    env: Partial<ReadinessEnv>,
    c: VerifyCondition = DEPLOYED
  ) => readiness(c, { ...READY, ...env });

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
      expect(readiness({ kind: "idl", instruction: "hello" }, bare)).toEqual(
        []
      );
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
        readinessLine(DEPLOYED, [{ kind: "needs-sol", signedIn: true }])
          ?.items[0].text
      ).toBe("airdrop -- the wallet holds no SOL");
    });
  });
}
