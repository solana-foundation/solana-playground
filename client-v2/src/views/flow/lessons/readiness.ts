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
