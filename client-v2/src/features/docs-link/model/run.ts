import { connectWallet } from "@/commands/connect/connect-wallet";
import { isSetupRejected } from "@/commands/connect/setup-rejected";
import { createLogger } from "@/shared/lib/logger";
import { PgCommand, PgConnection, PgExplorer, PgWallet, PgWeb3 } from "@/utils";
import type { RunResult } from "@/utils/js-runtime";
import { missingPackageOf } from "@/utils/js-runtime";

import type { DocsLink } from "../lib/link";
import { PgDocsLink } from "./opened";
import { restingOf } from "./resting";
import type { RunOutcome, WalletOrigin } from "./telemetry";
import { docsLinkTelemetry } from "./telemetry";

const log = createLogger("docs-link:run");

/** How a run that started ended */
type EndedState =
  | { kind: "done"; ms: number }
  | { kind: "failed"; message: string }
  | { kind: "missing-package"; pkg: string };

/** A state with no run going and no card asking for SOL */
export type RestingState = { kind: "idle" } | EndedState;

/** What the stage row's Run and its callout show */
export type RunState =
  | RestingState
  | {
      kind: "running";
      startedAt: number;
      /**
       * Whether a docs link opened the project, taken when the run starts:
       * only such a run sends the `docs_link_run_*` events
       */
      isFromLink: boolean;
      /** What the callout keeps showing while the run goes */
      previous: RestingState;
    }
  | {
      /**
       * The first Run of a link's code waits for the user to read it: the
       * dialog shows the link's file and the source it claims
       */
      kind: "confirm";
      link: DocsLink;
      /** What Cancel goes back to */
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

/**
 * How the question before a run from elsewhere ended: `run` (no link, a link
 * already agreed to, or Run), `no` (Cancel, another project, a question
 * already open), or `busy` (a run is going; the caller says so)
 */
export type RunAnswer = "run" | "no" | "busy";

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
/**
 * The link whose code the user agreed to run. Compared by identity: a new
 * link is a new object, so its code is asked about again.
 */
let confirmedLink: DocsLink | undefined;
/** Answers the open question before the first Run, if one is open */
let answer: ((isYes: boolean) => void) | undefined;

/** Answer the open question, if any, once */
const settle = (isYes: boolean) => {
  const pending = answer;
  answer = undefined;
  pending?.(isYes);
};

const set = (next: RunState) => {
  // Any state but the question closes it, with "no": a project that
  // switched, a run typed in the terminal, Cancel. Run answers "yes" first,
  // so this finds nothing left to answer
  if (next.kind !== "confirm") settle(false);
  state = next;
  listeners.forEach((listener) => listener(next));
};

/** Back to a clean callout, unless a run is still going */
const reset = () => {
  if (state.kind !== "running") set({ kind: "idle" });
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

/**
 * Whether a docs link opened the open project: read when a run starts, or
 * when it ends for a run that started before anything listened
 */
const isLinkOpen = () => PgDocsLink.opened !== undefined;

/**
 * Follow the `run` command's own events, so a `run` typed in the terminal
 * shows on the stage row like one from its button. Every run sets the state;
 * only a run in a project a docs link opened sends the `docs_link_run_*`
 * events. Started on first use, not at import: `PgCommand` reads the
 * command list, which is filled at startup.
 */
const listen = () => {
  if (isListening) return;

  PgCommand.run.onDidStart((input) => {
    if (isHelp(input)) return;
    started++;
    const isFromLink = isLinkOpen();
    if (isFromLink)
      docsLinkTelemetry.track("docs_link_run_started", { via: "link" });
    set({
      kind: "running",
      startedAt: Date.now(),
      isFromLink,
      previous: restingOf(state),
    });
  });
  PgCommand.run.onDidFinish((result) => {
    // A run that started before anything listened has no start to read
    const run =
      state.kind === "running"
        ? state
        : { startedAt: Date.now(), isFromLink: isLinkOpen() };
    const ms = Date.now() - run.startedAt;
    const next = settleWith(ms)(result);
    if (run.isFromLink) {
      const outcome: RunOutcome = next.kind;
      docsLinkTelemetry.track("docs_link_run_finished", {
        via: "link",
        outcome,
        seconds: Math.floor(ms / 1000),
      });
    }
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

/**
 * Ask before the first Run of code a docs link opened: the link is anyone's
 * to write, and its code runs with the Playground wallet. Asked before the
 * wallet setup, so Cancel leaves nothing behind.
 *
 * @param since `switches` when the press began
 * @returns whether to go on: no link, a link already agreed to, or Run
 */
const isAgreed = async (since: number): Promise<boolean> => {
  const link = PgDocsLink.opened;
  if (!link || link === confirmedLink) return true;
  // One question at a time: a second asker would orphan the first's answer
  if (answer) {
    log.debug("a run asked while the question was open; it runs nothing");
    return false;
  }
  const isYes = await new Promise<boolean>((resolve) => {
    answer = resolve;
    set({ kind: "confirm", link, previous: restingOf(state) });
  });
  // An answer for a project that is no longer open runs nothing
  if (!isYes || switches !== since || PgDocsLink.opened !== link) return false;
  confirmedLink = link;
  return true;
};

/** The wallet's balance now, read from the chain rather than the cached one */
const balanceOf = async (address: PgWeb3.PublicKey) =>
  PgWeb3.lamportsToSol(await PgConnection.current.getBalance(address));

/** What the SOL check found */
type Funds = "enough" | "short" | "project-left" | "running";

/**
 * The SOL check a docs link asks for: the funding card when the Playground
 * wallet holds less than the link's `sol`, else nothing. A browser wallet is
 * not checked: `signerFromFile` reads the Playground wallet only, and says so
 * when the script asks for it.
 *
 * @param since `switches` when the press began: another project opened
 * while the balance was read means the answer belongs to a project that is
 * no longer open, so no card is shown and nothing runs
 * @param runsBefore `started` when the press began: a run started elsewhere
 * since (the menu, the terminal), going or already ended, is the run, and a
 * card would cover it
 * @param wallet `new` when Run had to set the wallet up first; Check again
 * always reports `existing`, since the card's wallet exists by then
 */
const fundsFor =
  (since: number, runsBefore: number) =>
  async (wallet: WalletOrigin): Promise<Funds> => {
    const needed = PgDocsLink.opened?.sol;
    if (!needed) return "enough";

    const current = PgWallet.current;
    // `start` connects the wallet first, so this is a wallet that vanished
    if (!current) throw new Error("No wallet to run the script with.");
    if (!current.isPg) return "enough";

    const balance = await balanceOf(current.publicKey);
    if (switches !== since) return "project-left";
    if (started !== runsBefore) return "running";
    if (balance >= needed) return "enough";

    docsLinkTelemetry.track("docs_link_run_funding_shown", {
      funding_state: wallet,
    });
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
const walletForRun = async (): Promise<WalletOrigin | undefined> => {
  // Under the key-origin provider the wallet may still be loading, and
  // `fundsFor` reads `current`, derived a tick after the read is taken
  await PgWallet.untilCurrent();
  if (PgWallet.state !== "setup" && PgWallet.state !== "disconnected") {
    return "existing";
  }
  const origin: WalletOrigin = PgWallet.state === "setup" ? "new" : "existing";
  try {
    await connectWallet();
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
   * Start following `run`, so every run is shown, typed in the terminal or
   * not, and a run in a project a docs link opened sends the
   * `docs_link_run_*` events. The stage row calls it once it mounts; it is
   * safe to call again.
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
    const runsBefore = started;
    try {
      if (!(await isAgreed(since))) return;
      const wallet = await walletForRun();
      if (!wallet || switches !== since) return;
      if ((await fundsFor(since, runsBefore)(wallet)) !== "enough") return;
      // A run from the menu or the terminal went while Run waited on the
      // wallet: that was the run, and this one would run the scripts again
      if (started !== runsBefore) return;
    } finally {
      isStarting = false;
    }
    await runScripts();
  },

  /**
   * Ask before a run that does not start from Run, such as the explorer's
   * menu: the same question, once per link.
   *
   * @returns how the question ended
   */
  async askFirst(): Promise<RunAnswer> {
    listen();
    const link = PgDocsLink.opened;
    // A question is owed only for a link's code not agreed to yet. Then a
    // run going refuses it: the question would replace the running state
    // the stage row shows. Otherwise the command answers, as it always did
    const isOwed = link !== undefined && link !== confirmedLink;
    if (isOwed && state.kind === "running") {
      log.info("a run from elsewhere was refused: another run is going");
      return "busy";
    }
    return (await isAgreed(switches)) ? "run" : "no";
  },

  /** The question's Run: the user read the link's code and runs it */
  confirmRun() {
    if (state.kind !== "confirm") return;
    const { previous } = state;
    settle(true);
    set(previous);
  },

  /** The question's Cancel, or its dialog closed: nothing runs */
  cancelRun() {
    if (state.kind !== "confirm") return;
    set(state.previous);
  },

  /** The funding card's Check again */
  async checkAgain() {
    if (isStarting) return;
    isStarting = true;
    const since = switches;
    const runsBefore = started;
    let funds: Funds;
    try {
      funds = await fundsFor(since, runsBefore)("existing");
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
