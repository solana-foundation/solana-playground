import type { Disposable } from "../../utils";

/** A step of a deploy run, in the order the run takes them */
export type DeployStep = "funding" | "buffer" | "write" | "deploy";

/** Where the running deploy is; `step` is `null` while none runs */
export interface DeployRunState {
  step: DeployStep | null;
  /** How much of the program the write step has sent, 0 to 100 */
  percent: number;
  /** The run tops the wallet up first, so "funding" is one of its steps */
  funds: boolean;
  /** The program exists on the cluster, so the last step upgrades it */
  upgrade: boolean;
}

/** What a finished deploy reports to whoever started it */
export interface DeployResult {
  /** The deploy or upgrade transaction; `undefined` when the RPC returned none */
  signature: string | undefined;
  /**
   * Lamports the paying wallets spent on the run, fees included; `undefined`
   * when the balance after it could not be read
   */
  cost: number | undefined;
  upgraded: boolean;
}

/**
 * Answers a caller gives the deploy in place of the terminal's questions.
 * Their presence also means the run asks nothing about funding: it airdrops
 * or stops at the funding card, as `airdrop` says.
 */
export interface DeployAnswers {
  /** The last build failed: deploy the last successful build anyway? */
  confirmStaleBuild(): Promise<boolean>;
  /**
   * The run may request an airdrop for a short wallet: the user turned on
   * `wallet.automaticAirdrop` or pressed "Request airdrop"
   */
  airdrop: boolean;
}

/** Why a run could not fund its wallet */
export type FundingFailure =
  | "signed_out"
  | "no_faucet"
  | "airdrop_off"
  | "airdrop_failed";

/** A run with answers stopped: the wallet holds too little SOL and could not be funded (`reason`) */
export class DeployFundingError extends Error {
  constructor(
    readonly detail: {
      reason: FundingFailure;
      /** Lamports the wallet holds */
      balance: number;
      /** Lamports the deploy needs, fees excluded */
      needed: number;
      address: string;
      /** What the airdrop said, for `airdrop_failed` */
      cause: string | null;
    }
  ) {
    super(
      detail.reason === "signed_out"
        ? "Sign in with GitHub to request SOL from the faucet."
        : "Not enough SOL to deploy."
    );
    this.name = "DeployFundingError";
  }
}

/** The user said no to deploying the last successful build */
export class DeployCancelledError extends Error {
  constructor() {
    super("Deployment cancelled: last build failed.");
    this.name = "DeployCancelledError";
  }
}

const IDLE: DeployRunState = {
  // eslint-disable-next-line unicorn/no-null -- `DeployRunState.step` is `null` while no deploy runs, as the Deploy stage and its tests read it
  step: null,
  percent: 0,
  funds: false,
  upgrade: false,
};

/**
 * The running deploy's progress, read by the Deploy stage, and the answers
 * its caller gave for this one run. The terminal never sets answers, so a
 * typed `deploy` keeps asking in the terminal.
 */
export class PgDeployRun {
  static get state(): DeployRunState {
    return PgDeployRun._state;
  }

  static get answers(): DeployAnswers | undefined {
    return PgDeployRun._answers;
  }

  /**
   * The last step the latest run reached; kept after the run ends, so a
   * caller that catches the run's error can say where it stopped
   */
  static get lastStep(): DeployStep | undefined {
    return PgDeployRun._lastStep;
  }

  static onDidChange(cb: (state: DeployRunState) => void): Disposable {
    PgDeployRun._listeners.add(cb);
    return { dispose: () => PgDeployRun._listeners.delete(cb) };
  }

  /**
   * Run what is passed next with `answers` in place of the terminal's
   * questions; they apply to that run alone.
   */
  static runWith(answers: DeployAnswers) {
    return async <T>(start: () => Promise<T>): Promise<T> => {
      // Restored, not cleared: a run started inside another keeps its own
      const outer = PgDeployRun._answers;
      PgDeployRun._answers = answers;
      PgDeployRun._lastStep = undefined;
      try {
        return await start();
      } finally {
        PgDeployRun._answers = outer;
      }
    };
  }

  /** Record the run's progress; the deploy command alone calls it */
  static update(patch: Partial<DeployRunState>) {
    const prev = PgDeployRun._state;
    const next = { ...prev, ...patch };
    // The write step reports every chunk; a percent that did not move
    // re-renders nothing
    const keys = Object.keys(next) as Array<keyof DeployRunState>;
    if (keys.every((k) => next[k] === prev[k])) return;
    PgDeployRun._state = next;
    if (next.step) PgDeployRun._lastStep = next.step;
    for (const cb of PgDeployRun._listeners) cb(next);
  }

  /** Back to no run; the deploy command calls it when it ends */
  static reset() {
    PgDeployRun._state = IDLE;
    for (const cb of PgDeployRun._listeners) cb(IDLE);
  }

  private static _state: DeployRunState = IDLE;
  private static _answers: DeployAnswers | undefined;
  private static _lastStep: DeployStep | undefined;
  private static readonly _listeners = new Set<
    (state: DeployRunState) => void
  >();
}
