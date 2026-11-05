import { isSetupRejected } from "@/commands/connect/setup-rejected";
import { createLogger } from "@/shared/lib/logger";
import { PgCommand, PgConnection, PgExplorer, PgWallet, PgWeb3 } from "@/utils";
import type { RunResult } from "@/utils/js-runtime";
import { missingPackageOf } from "@/utils/js-runtime";

import { PgDocsLink } from "./opened";
import type { RunOutcome, RunSource, WalletOrigin } from "./telemetry";
import { docsLinkTelemetry } from "./telemetry";

const log = createLogger("docs-link:run");

/** How a run that started ended */
type EndedState =
  | { kind: "done"; ms: number }
  | { kind: "failed"; message: string }
  | { kind: "missing-package"; pkg: string };

/** A state with no run going and no card asking for SOL */
type RestingState = { kind: "idle" } | EndedState;

/** What the stage row's Run and its callout show */
export type RunState =
  | RestingState
  | {
      kind: "running";
      startedAt: number;
      /** Whether a docs link opened the project, taken when the run starts */
      source: RunSource;
      /** What the callout keeps showing while the run goes */
      previous: RestingState;
    }
  | {
      kind: "funding";
      address: string;
      balance: number;
      needed: number;
      /** What Not now goes back to */
      previous: RestingState;
    };

type Listener = (state: RunState) => void;

let state: RunState = { kind: "idle" };
/**
 * Run was pressed and is still setting the wallet up or reading its SOL. A
 * guard against a second press, not a state to show: the setup modal or the
 * funding card is what the user sees meanwhile.
 */
let isStarting = false;
/** How many runs have started, so `runScripts` can tell whether its own did */
let started = 0;
/**
 * How many times another project opened, so a Run or a Check again that
 * waited on the wallet can tell its project is gone and run nothing
 */
let switches = 0;
let isListening = false;
const listeners = new Set<Listener>();

const set = (next: RunState) => {
  state = next;
  listeners.forEach((listener) => listener(next));
};

/** Back to a clean callout, unless a run is still going */
const reset = () => {
  if (state.kind !== "running") set({ kind: "idle" });
};

/** @returns what Not now should return to from the current state */
const restingOf = (current: RunState): RestingState => {
  if (current.kind === "funding" || current.kind === "running") {
    return current.previous;
  }
  return current;
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** A failure, or the missing package it names */
const failure = (message: string): EndedState => {
  const pkg = missingPackageOf(message);
  return pkg ? { kind: "missing-package", pkg } : { kind: "failed", message };
};

/**
 * How a finished `run` reads, from what the command handed back: a
 * `RunResult`, or the error it threw before any script ran. A missing
 * package can come either way: thrown while loading the script, or
 * reported by the script's own wrapper when its import fails.
 */
const settleWith =
  (ms: number) =>
  (result: { ok: RunResult | undefined } | { err: unknown }): EndedState => {
    if ("err" in result) return failure(messageOf(result.err));
    if (result.ok && !result.ok.ok) return failure(result.ok.error);
    return { kind: "done", ms };
  };

/**
 * Whether a `run` typed in the terminal only asks for its help, which prints
 * and ends with no finish event, so it must not show as a run. The command
 * reads `-h` as help only right after its name; anywhere else the run goes.
 */
const isHelp = (input: string | null) =>
  /^\s*\S+\s+(-h|--help)(\s|$)/.test(input ?? "");

/** Whether a docs link opened the project a run starts on */
const currentSource = (): RunSource => (PgDocsLink.opened ? "link" : "project");

/**
 * Follow the `run` command's own events, so a `run` typed in the terminal
 * shows on the stage row like one from its button. Started on first use, not
 * at import: `PgCommand` reads the command list, which is filled at startup.
 */
const listen = () => {
  if (isListening) return;

  PgCommand.run.onDidStart((input) => {
    if (isHelp(input)) return;
    started++;
    const source = currentSource();
    docsLinkTelemetry.track("docs_link_run_started", { source });
    set({
      kind: "running",
      startedAt: Date.now(),
      source,
      previous: restingOf(state),
    });
  });
  PgCommand.run.onDidFinish((result) => {
    // A run that started before anything listened has no start to read
    const run =
      state.kind === "running"
        ? state
        : { startedAt: Date.now(), source: currentSource() };
    const ms = Date.now() - run.startedAt;
    const next = settleWith(ms)(result);
    const outcome: RunOutcome = next.kind;
    docsLinkTelemetry.track("docs_link_run_finished", {
      source: run.source,
      outcome,
      seconds: Math.floor(ms / 1000),
    });
    set(next);
  });

  // A new link, a broken one, or another project opened starts from a clean
  // callout: the last run's end belongs to the project it ran
  PgDocsLink.onDidChange(reset);
  PgExplorer.onDidSwitchWorkspace(() => {
    switches++;
    reset();
  });

  isListening = true;
};

/** The wallet's balance now, read from the chain rather than the cached one */
const balanceOf = async (address: PgWeb3.PublicKey) =>
  PgWeb3.lamportsToSol(await PgConnection.current.getBalance(address));

/** What the SOL check found */
type Funds = "enough" | "short" | "project-left";

/**
 * The SOL check a docs link asks for: the funding card when the Playground
 * wallet holds less than the link's `sol`, else nothing. A browser wallet is
 * not checked: `signerFromFile` reads the Playground wallet only, and says so
 * when the script asks for it.
 *
 * @param since `switches` when the press began: another project opened
 * while the balance was read means the answer belongs to a project that is
 * no longer open, so no card is shown and nothing runs
 * @param wallet `new` when Run had to set the wallet up first; Check again
 * always reports `existing`, since the card's wallet exists by then
 */
const fundsFor =
  (since: number) =>
  async (wallet: WalletOrigin): Promise<Funds> => {
    const needed = PgDocsLink.opened?.sol;
    if (!needed) return "enough";

    const current = PgWallet.current;
    // `start` connects the wallet first, so this is a wallet that vanished
    if (!current) throw new Error("No wallet to run the script with.");
    if (!current.isPg) return "enough";

    const balance = await balanceOf(current.publicKey);
    if (switches !== since) return "project-left";
    if (balance >= needed) return "enough";

    docsLinkTelemetry.track("docs_link_run_funding_shown", { wallet });
    set({
      kind: "funding",
      address: current.publicKey.toBase58(),
      balance,
      needed,
      previous: restingOf(state),
    });
    return "short";
  };

/**
 * Connect the wallet when Run finds none: the setup for a first visit, the
 * Playground wallet again after a disconnect.
 *
 * @returns how the wallet came to be, or `undefined` when there is nothing
 * to run with: the user closed the setup (the state is left alone), or
 * connect ended with no wallet (shown as `failed`)
 */
const connectWallet = async (): Promise<WalletOrigin | undefined> => {
  if (PgWallet.state !== "setup" && PgWallet.state !== "disconnected") {
    return "existing";
  }
  const origin: WalletOrigin = PgWallet.state === "setup" ? "new" : "existing";
  try {
    await PgCommand.connect.execute();
  } catch (error) {
    if (!isSetupRejected(error)) throw error;
    // The user closed the setup: nothing to run with, and they know why
    log.info("wallet setup closed before the run");
    return undefined;
  }
  if (PgWallet.current) return origin;
  log.warn("connect ended without a wallet; nothing to run with");
  set({
    kind: "failed",
    message: "No wallet is connected. Connect one, then press Run again.",
  });
  return undefined;
};

/**
 * Run the scripts. A rejection the command threw before it started never
 * reaches `onDidFinish` (another run in progress, say), so it is shown here.
 */
const runScripts = async () => {
  // A `run` typed in the terminal while Run read the wallet is the run: this
  // one would be refused, and its refusal would cover the running one
  if (state.kind === "running") return;
  const before = started;
  try {
    await PgCommand.run.execute();
  } catch (error) {
    // A run that started has settled through `onDidFinish`, which the
    // command calls before it rethrows: its state already says how it ended
    if (started !== before) {
      log.debug("a started run threw; its finish already shows it", {
        context: { error },
      });
      return;
    }
    log.warn("run refused before it started", { context: { error } });
    set({ kind: "failed", message: messageOf(error) });
  }
};

/** The stage row's Run, its funding card's buttons and its state */
export const PgClientRun = {
  get state() {
    return state;
  },

  /**
   * Start following `run`, so every run is shown and measured, typed in the
   * terminal or not. The stage row calls it once it mounts; it is safe to
   * call again.
   */
  follow() {
    listen();
  },

  /**
   * @param listener called with the current state, then on every change
   * @returns a disposable that removes the listener
   */
  onDidChange(listener: Listener) {
    listen();
    listeners.add(listener);
    listener(state);
    return { dispose: () => void listeners.delete(listener) };
  },

  /** Connect the wallet if needed, check its SOL, then `run` */
  async start() {
    listen();
    // One run at a time, counting the wallet setup and balance read before it
    if (state.kind === "running" || isStarting) return;
    isStarting = true;
    const since = switches;
    try {
      const wallet = await connectWallet();
      if (!wallet || switches !== since) return;
      if ((await fundsFor(since)(wallet)) !== "enough") return;
    } finally {
      isStarting = false;
    }
    await runScripts();
  },

  /** The funding card's Check again */
  async checkAgain() {
    if (isStarting) return;
    isStarting = true;
    const since = switches;
    let funds: Funds;
    try {
      funds = await fundsFor(since)("existing");
    } finally {
      isStarting = false;
    }
    if (funds === "enough") await runScripts();
  },

  /** The funding card's Not now */
  dismissFunding() {
    if (state.kind === "funding") set(state.previous);
  },
};
