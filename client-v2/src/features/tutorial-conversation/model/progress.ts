/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { Idl } from "@coral-xyz/anchor";
import { z } from "zod";

import type {
  Act,
  ConversationSave,
  QuestionResult,
} from "@/entities/tutorial";
import { createLogger } from "@/shared/lib/logger";

import type { DeployedIdl } from "./deployed-idl";
import { parseDeployed } from "./deployed-idl";

const log = createLogger("tutorial-conversation:progress");

/**
 * What a conversation tutorial saves under `conversation` in
 * `.workspace/tutorial-storage.json`: facts, never copy. The feed's turns are
 * a fold over this and the definition (`view.ts`), so a fixed typo in the
 * definition shows on reload. Project sync carries the file.
 *
 * `version`, `passed` and `finishedAt` are the contract the tutorials card
 * reads (`conversationProgressOf` in `entities/tutorial`); the rest is the
 * engine's own.
 */
export interface ConversationProgress extends ConversationSave {
  version: 1;
  passed: string[];
  finishedAt: number | null;
  /** When Start was pressed, in ms, or null before it */
  startedAt: number | null;
  /**
   * When Start over last reset this save, or null. The assistant's thread
   * is kept across a restart, and the feed shows only its exchanges after
   * this moment (task 3.6 filters on it).
   */
  restartedAt: number | null;
  cursor: Cursor;
  /** Every beat the lesson has reached, by id */
  beats: Record<string, Resolution>;
  /** Every run of each act, by beat id, oldest first: a run again keeps
   * the earlier run as its record in the feed */
  runs: Record<string, RunRecord[]>;
  /** When each step started and passed, by step id, for the divider's time */
  times: Record<string, StepTime>;
  /**
   * What the composer posted in the lesson's own feed, oldest first (task
   * 3.6). Added after version 1 shipped: a save without it reads as none.
   */
  said: Said[];
  /** Changes the assistant proposed as apply cards, oldest first; added
   * after version 1 shipped, like `said` */
  proposals: Proposal[];
  /**
   * The address each landed call last wrote to, by the account's IDL name:
   * later calls send it, since an account with no seeds cannot be derived.
   * Added after version 1 shipped, like `said`. A step's Reset keeps it: the
   * step's own create call replaces what it wrote.
   */
  accounts: Record<string, string>;
  /**
   * The IDL the last landed deploy was built from, for the Call panel; absent
   * before any deploy. Added after version 1 shipped, like `said`. Only a deploy
   * card writes it: one from the terminal moves nothing until the card runs.
   */
  deployed?: DeployedIdl;
}

/**
 * A composer message the lesson answered itself, with no model: a typed
 * action word echoed as a pill (the act it ran records itself; "explain"
 * has none, since Explain the error echoes itself), the same
 * word refused while a question is open, or a finish chip pressed (its
 * answer is the definition's, never saved).
 */
export type Said =
  | { kind: "word"; text: string; at: number }
  | { kind: "refused"; text: string; at: number }
  | { kind: "chip"; index: number; at: number };

/**
 * One line the assistant proposed to change, as its apply card shows it. It
 * is never applied by itself: Apply writes it, Keep it leaves the file.
 */
export interface Proposal {
  id: string;
  /** Workspace path: `programs/hello/src/lib.rs` */
  file: string;
  /** 1-based */
  line: number;
  /** The line as the assistant read it, to refuse an Apply after it moved */
  before: string;
  after: string;
  at: number;
  state: "open" | "applied" | "kept";
  /** When Apply landed or Keep it was pressed */
  settledAt?: number;
  /**
   * Why the last Apply did not land; the card stays open. After `write` a
   * retry can land; after `moved` it lands only once the line reads `before`
   * again, and after `gone` only once the file is back with that line.
   */
  applyFailed?: ApplyFailure;
}

/**
 * Why an Apply did not land: the line no longer read as proposed (`moved`),
 * the file is no longer there (`gone`), or reading or writing it failed
 * (`write`)
 */
export type ApplyFailure = "moved" | "gone" | "write";

/** Where the lesson stands: before Start, in a step, or past the last win */
export type Cursor =
  | { kind: "intro" }
  | {
      kind: "step";
      stepId: string;
      /** Index of the next beat to post in `beats`, or in `onFail` */
      beat: number;
      /** Whether the step is running its planned failure's beats */
      fail: boolean;
    }
  | { kind: "finished" };

export interface StepTime {
  from: number;
  to: number | null;
  /** How the step passed: an act card, a client run or the Call panel */
  via?: PassedVia;
  /** The account the goal creates already existed; absent on any other pass */
  reason?: PassReason;
}

export type PassedVia = "chat" | "client" | "call_panel";

/** Why a step passed other than on its own result landing */
export type PassReason = "exists";

/**
 * The account a goal's instruction creates was already on chain, so nothing
 * was created: the System Program refused the call as "already in use", or a
 * client run found the account at its seeds' address and sent nothing
 */
export interface Exists {
  instruction: string;
  /** The account's IDL name, as the goal's `creates` gives it */
  account: string;
  /** Absent when the System Program's log line named none */
  address?: string;
}

/** What the result card and the Call panel say about an existing account */
export const existsLine = (exists: Exists): string =>
  `\`${exists.account}\` already exists on devnet, so nothing was created.`;

/** The existing account a failed run or call found, if any */
export const existsOf = (r: RunResult): Exists | undefined =>
  (r.act === "run" || r.act === "call") && !r.ok && "exists" in r
    ? r.exists
    : undefined;

/**
 * A beat's state once the lesson has reached it. A `say` is `said`; a
 * `write` is `written` once the block landed; a question is `open` until a
 * right pick, the key line typed, Skip, or the step passing around it
 * (`pass`) resolves it; an act is `said`, its run living in `runs`.
 */
export type Resolution =
  | { kind: "said"; at: number; writeFailed?: true }
  | { kind: "written"; at: number; wrote: Wrote }
  | {
      kind: "open";
      at: number;
      wrong: number[];
      hintedAt?: number;
      /** The live assistant's Hint tool asked for it, after the learner's
       * own message: no "I'm stuck" pill (task 3.6) */
      hintByAssistant?: true;
    }
  | ({
      kind: "picked";
      option: number;
      /** 1 to 3: the right pick counts */
      attempts: number;
    } & Resolved)
  | ({ kind: "typed" } & Resolved)
  | ({ kind: "skipped"; via: SkipVia } & Resolved);

/**
 * How a resolved question counts, for its record and its event; null for a
 * beat that is not a resolved question. The one mapping: the record's
 * qualifier and `tutorial_question_answered` must never disagree.
 */
export const answerOf = (r: Resolution): QuestionResult | null => {
  switch (r.kind) {
    case "picked":
      return r.attempts === 1 ? "first_try" : "retry";
    case "typed":
      return "typed";
    case "skipped":
      return r.via === "call_panel" ? "call_panel" : "skipped";
    case "said":
    case "written":
    case "open":
      return null;
    default: {
      const never: never = r;
      return never;
    }
  }
};

/**
 * How a question was skipped: its Skip button, a Call panel call that passed
 * the step, or the step passing from somewhere else (a client run), which
 * writes nothing and posts no Skip line
 */
export type SkipVia = "button" | "call_panel" | "elsewhere";

/** What every resolved question carries */
interface Resolved {
  /** The answer's block could not be written; the learner was told */
  writeFailed?: true;
  /** When it resolved */
  at: number;
  /** When the question arrived, so its card keeps its place in the feed */
  openedAt: number;
  wrong: number[];
  hintedAt?: number;
  hintByAssistant?: true;
  /** The block the answer wrote, once it landed */
  wrote?: Wrote;
}

/** Lines a write took in a file, counted from 1; none for a created file */
export interface Wrote {
  file: string;
  lines: number[];
  /**
   * Each written line's text as the block landed, in the order of `lines`:
   * the card draws these, so the learner's later edits to the file leave it
   * as the lesson wrote it. Absent in a save from before it was kept, where
   * the card reads those lines from the file.
   */
  text?: string[];
  created?: true;
  /** The learner's own lines kept the block from its place: it went to the
   * end of the file, and its card offers to restart the step */
  appended?: true;
}

/**
 * One act's run. `started` is what the save holds while the run is in
 * flight; a reload turns it into `interrupted` (`parseProgress`), since a
 * run never resumes and is never repeated by the engine.
 */
// TODO(HOO-2362): operate run statuses through an enum or typed invariants, not string literals compared by hand
export type RunRecord =
  | { status: "started"; at: number }
  | { status: "interrupted"; at: number }
  | { status: "ok"; at: number; took: number; result: RunResult }
  /**
   * A failed run or call the step's goal accepts: a refusal its `refused`
   * goal names, or the account its `call` goal `creates` already existing
   */
  | { status: "refused"; at: number; took: number; result: RunResult }
  | {
      status: "failed";
      at: number;
      took: number;
      result: RunResult;
      /** The failure the step plans, judged once when the run ended */
      planned?: true;
      /** An unplanned failure: when Explain sent it to the assistant */
      explainedAt?: number;
      /** When the assistant's answer to it ended: "Show me the fix" follows */
      answeredAt?: number;
      /** When "Show me the fix" wrote the step's target; it works once */
      fixedAt?: number;
    };

/**
 * Why a build failed: the code, a server that never answered, or a server
 * that builds only for a signed-in GitHub user (HOO-2422)
 */
export type BuildFailure = "compiler" | "unreachable" | "signed_out";

/** A build whose server never answered: nothing to explain, only Try again */
export const isUnreachable = (r: RunResult): boolean =>
  r.act === "build" && !r.ok && r.reason === "unreachable";

/**
 * A build the server refused because nobody is signed in: not a failure of
 * the code, so nothing to explain; its card asks for a sign-in (HOO-2661)
 */
export const isSignedOut = (r: RunResult): boolean =>
  r.act === "build" && !r.ok && r.reason === "signed_out";

/**
 * A run or call devnet has not read back yet (HOO-2675): sent, not failed,
 * so nothing to explain; its card's way on is Check again
 */
export const isUnconfirmed = (r: RunResult): boolean =>
  (r.act === "run" || r.act === "call") && !r.ok && r.reason === "unconfirmed";

/** A failed run or call the program could not match (HOO-2688) */
export const isMismatch = (r: RunResult): boolean =>
  (r.act === "call" || r.act === "run") &&
  !r.ok &&
  "mismatch" in r &&
  r.mismatch === true;

/** The compiler error a failed build's card shows, as the server's log names it */
export interface BuildError {
  code: string | null;
  file: string | null;
  line: number | null;
  column: number | null;
  message: string;
}

/**
 * One instruction a run invoked, with its argument values by name, each as
 * the decoded value's string form. The client run and the call act (task
 * 4.3) and the Call panel (task 4.4) fill it; none, or an empty list, fails
 * every call goal.
 */
export interface Called {
  instruction: string;
  args: Record<string, string>;
}

/** An account as the chain held it right after a run, for its cards */
export interface AccountReading {
  /** The name the act's view gives it */
  name: string;
  address: string;
  /** The account's data, in bytes */
  size: number;
  /** Its fields that read as one value, as strings; empty if it did not decode */
  fields: Record<string, string>;
}

/** One account a transaction touched, as the receipt lists it */
export interface ReceiptAccount {
  /** The IDL's name for it, or a role such as "program" */
  name: string;
  address: string;
}

/**
 * A landed transaction's facts, each optional: see a run's or a call's
 * `receipt`. The shape is the finish card's "Transaction details";
 * `computeUnits` is for the result card's details sentence.
 */
export interface Receipt {
  /** The fee in lamports */
  fee?: number;
  /** The wallet that signed */
  signer?: string;
  accounts?: ReceiptAccount[];
  /** The transaction's log, line by line */
  log?: string[];
  /** Compute units the transaction consumed */
  computeUnits?: number;
}

/**
 * What the program refused in a failed run or call: the instruction, and the
 * error it returned, or null for a refusal with no code (a panic, running out
 * of memory), which the transaction's log names instead
 */
export interface Refusal {
  instruction: string;
  error: { code: number; name: string | null } | null;
}

/**
 * A transaction a run or call sent, kept so it can be read from devnet again
 * without sending: its signature and its instructions to the program, as the
 * deployed IDL decoded them when it was sent
 */
export interface UnreadTx {
  signature: string;
  calls: (Called & { accounts: ReceiptAccount[]; wrote: ReceiptAccount[] })[];
  /** One of them did not decode, so `calls` may be short */
  undecoded?: true;
}

/**
 * The facts a run leaves behind, by act. These are the fields the spec's
 * result cards read; the run tickets (4.1 to 4.3) add to them, never rename.
 */
export type RunResult =
  | { act: "build"; ok: true; seconds: number; instructions: string[] }
  | {
      act: "build";
      ok: false;
      seconds: number;
      /**
       * `compiler`: the server answered and the build failed, or the server
       * refused the request; `unreachable`: no answer reached the browser;
       * `signed_out`: the server builds only for a signed-in user
       */
      reason: BuildFailure;
      error: BuildError | null;
      log: string;
    }
  | {
      act: "deploy" | "buildDeploy";
      ok: true;
      seconds: number;
      programId: string;
      signature: string;
      upgraded: boolean;
      /**
       * Lamports the deploy took from the wallet; null for a deploy
       * recognised from the chain after a reload, whose cost is not known
       */
      lamports: number | null;
      instructions: string[];
      /**
       * The IDL this deploy put on chain. The engine moves it to the save's
       * `deployed` rather than keep a copy in every run's record.
       */
      idl?: Idl;
    }
  | {
      act: "airdrop";
      ok: true;
      seconds: number;
      /** Lamports the wallet holds once the airdrop showed, or already held */
      balance: number;
      /** Lamports the airdrop added; 0 for a wallet that was already funded */
      airdropped: number;
      /** The press made the Playground wallet before it asked the faucet */
      madeWallet?: true;
    }
  | {
      /** A deploy's failures, and an airdrop's, which share its cards */
      act: "airdrop" | "deploy" | "buildDeploy";
      ok: false;
      seconds: number;
      reason: "failed" | "no_wallet";
      message: string;
    }
  | {
      act: "airdrop" | "deploy" | "buildDeploy";
      ok: false;
      seconds: number;
      /**
       * The wallet cannot pay for the deploy: the airdrop was refused or rate
       * limited, or the deploy found it short
       */
      reason: "no_funds";
      message: string;
      /** Lamports the wallet holds, the line's "{balance} SOL" */
      balance: number;
      /** Lamports the deploy needs, the line's "about {cost}" */
      cost: number;
      /** The wallet's address, for the card's address row */
      address: string;
    }
  | {
      act: "run" | "call";
      ok: true;
      seconds: number;
      signatures: string[];
      /** The program log line the definition's pattern picked, if any */
      line: string | null;
      /** The accounts the calls wrote to, other than the wallet, oldest first */
      wrote?: ReceiptAccount[];
      /** The account the act names, read from the chain once the run landed */
      account?: AccountReading;
      /**
       * Each instruction the run's transactions invoked on the tutorial's
       * program, with its arguments as the deployed IDL decodes them. A call
       * goal's arguments are checked here, not in the log: before the
       * upgrade the deployed `hello` takes no `name`, so none is sent.
       */
      called: Called[];
      /**
       * An instruction to the program did not decode, so `called` may be short
       * and nothing can be said about what the run did not call
       */
      undecoded?: true;
      /**
       * The receipt of the transaction the signatures end on: the result
       * card's details sentence and the finish card's "Transaction details". Each
       * field is optional, and the cards draw only the rows they have.
       */
      receipt?: Receipt;
    }
  | {
      act: "run" | "call";
      ok: false;
      seconds: number;
      message: string;
      log: string;
      /**
       * Why nothing reached the chain: no wallet, or the run sent no
       * transaction. Absent for a run that sent and failed, or that could not
       * run at all.
       */
      reason?: "no_wallet" | "no_transaction";
      /**
       * The call did not match the program on chain: the IDL has no such
       * instruction, or the program refused it as one it does not know or
       * cannot deserialize. `message` then says so (`MISMATCH`)
       */
      mismatch?: true;
      /**
       * What the program refused, when the transaction reached it; absent
       * when it never did (no wallet, a send that failed). A `refused` goal
       * is judged on it and on `log`. The runner fills it from the program's
       * log: Anchor's error, else the custom code the runtime names.
       */
      refused?: Refusal;
      /**
       * The account the live goal's `creates` names was already there, which
       * a `call` goal with `creates` accepts
       */
      exists?: Exists;
    }
  | {
      act: "run" | "call";
      ok: false;
      seconds: number;
      message: string;
      log: string;
      /** The faucet refused the top-up and the wallet cannot pay a fee */
      reason: "no_funds";
      /** The "Not enough devnet SOL" card's facts, in lamports */
      funding: { balance: number; cost: number; address: string };
      refused?: undefined;
    }
  | {
      act: "run" | "call";
      ok: false;
      seconds: number;
      message: string;
      log: string;
      /**
       * Sent, but devnet did not read a transaction back in the read window:
       * on a slow devnet it may still land, so this is no failure of the
       * learner's, and "Check again" reads the `unconfirmed` transactions
       * again, without sending
       */
      reason: "unconfirmed";
      /** Every transaction the run sent, in order, to read again */
      unconfirmed: UnreadTx[];
      refused?: undefined;
    };

export const freshProgress = (
  restartedAt: number | null = null
): ConversationProgress => ({
  version: 1,
  passed: [],
  finishedAt: null,
  startedAt: null,
  restartedAt,
  cursor: { kind: "intro" },
  beats: {},
  runs: {},
  times: {},
  said: [],
  proposals: [],
  accounts: {},
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isMs = (v: unknown): v is number => Number.isFinite(v);

/** A count of lamports: a whole number, never negative */
const isLamports = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;

const isMsOrNull = (v: unknown): v is number | null => v === null || isMs(v);

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");

const isIndexes = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((n) => Number.isInteger(n));

/** Every act a save may name; a `Record`, so a new act cannot be left out */
const ACT_KINDS: Record<Act, true> = {
  airdrop: true,
  build: true,
  deploy: true,
  buildDeploy: true,
  run: true,
  call: true,
};
const ACTS = Object.keys(ACT_KINDS) as readonly Act[];
const SKIP_VIAS: readonly SkipVia[] = ["button", "call_panel", "elsewhere"];

const parseCursor = (v: unknown): Cursor | null => {
  if (!isRecord(v)) return null;
  if (v.kind === "intro" || v.kind === "finished") return { kind: v.kind };
  if (
    v.kind === "step" &&
    typeof v.stepId === "string" &&
    Number.isInteger(v.beat) &&
    (v.beat as number) >= 0 &&
    typeof v.fail === "boolean"
  ) {
    return {
      kind: "step",
      stepId: v.stepId,
      beat: v.beat as number,
      fail: v.fail,
    };
  }
  return null;
};

/**
 * A block's landing as saved: `Wrote`. A flag that is not `true` and text
 * that is not a list of strings read as absent rather than failing the
 * landing; text drawn from the file is the fallback for the latter.
 */
const wroteSchema = z.object({
  file: z.string(),
  lines: z.array(z.number().int()),
  text: z.array(z.string()).optional().catch(undefined),
  created: z.literal(true).optional().catch(undefined),
  appended: z.literal(true).optional().catch(undefined),
});

const parseWrote = (v: unknown): Wrote | null => {
  const parsed = wroteSchema.safeParse(v);
  if (!parsed.success) return null;
  const { file, lines, text, created, appended } = parsed.data;
  const wrote: Wrote = { file, lines };
  // Text that does not pair with the lines is dropped: the card then reads
  // the file, as for a save from before text was kept
  if (text && text.length === lines.length) wrote.text = text;
  if (created) wrote.created = true;
  if (appended) wrote.appended = true;
  return wrote;
};

/** A question's hint fields as saved: its time, and who asked, when there
 * was one */
const parseHint = (
  v: Record<string, unknown>
): { hintedAt?: number; hintByAssistant?: true } => {
  if (!isMs(v.hintedAt)) return {};
  return v.hintByAssistant === true
    ? { hintedAt: v.hintedAt, hintByAssistant: true }
    : { hintedAt: v.hintedAt };
};

/**
 * A question's hint fields, carried from its open state to its resolution
 * unchanged
 */
export const hintOf = (r: {
  hintedAt?: number;
  hintByAssistant?: true;
}): { hintedAt?: number; hintByAssistant?: true } => {
  if (!r.hintedAt) return {};
  return r.hintByAssistant
    ? { hintedAt: r.hintedAt, hintByAssistant: true }
    : { hintedAt: r.hintedAt };
};

/** The fields every resolved question carries, or null when one is off */
const parseResolved = (v: Record<string, unknown>): Resolved | null => {
  if (!isMs(v.at) || !isMs(v.openedAt) || !isIndexes(v.wrong)) return null;
  const out: Resolved = { at: v.at, openedAt: v.openedAt, wrong: v.wrong };
  Object.assign(out, parseHint(v));
  if (v.writeFailed === true) out.writeFailed = true;
  if (v.wrote !== undefined) {
    const wrote = parseWrote(v.wrote);
    if (!wrote) return null;
    out.wrote = wrote;
  }
  return out;
};

/** An unknown entry is dropped rather than failing the whole save */
const parseResolution = (v: unknown): Resolution | null => {
  if (!isRecord(v) || !isMs(v.at)) return null;
  const at = v.at;
  switch (v.kind) {
    case "said":
      return v.writeFailed === true
        ? { kind: "said", at, writeFailed: true }
        : { kind: "said", at };
    case "written": {
      const wrote = parseWrote(v.wrote);
      return wrote ? { kind: "written", at, wrote } : null;
    }
    case "open": {
      if (!isIndexes(v.wrong)) return null;
      const open: Resolution = { kind: "open", at, wrong: v.wrong };
      return Object.assign(open, parseHint(v));
    }
    case "picked": {
      const resolved = parseResolved(v);
      return resolved &&
        Number.isInteger(v.option) &&
        Number.isInteger(v.attempts)
        ? {
            kind: "picked",
            option: v.option as number,
            attempts: v.attempts as number,
            ...resolved,
          }
        : null;
    }
    case "typed": {
      const resolved = parseResolved(v);
      return resolved ? { kind: "typed", ...resolved } : null;
    }
    case "skipped": {
      const resolved = parseResolved(v);
      return resolved && SKIP_VIAS.includes(v.via as SkipVia)
        ? { kind: "skipped", via: v.via as SkipVia, ...resolved }
        : null;
    }
    default:
      return null;
  }
};

const isCalled = (v: unknown): v is Called =>
  isRecord(v) &&
  typeof v.instruction === "string" &&
  isRecord(v.args) &&
  Object.values(v.args).every((a) => typeof a === "string");

const isRefusal = (v: unknown): v is Refusal =>
  isRecord(v) &&
  typeof v.instruction === "string" &&
  (v.error === null ||
    (isRecord(v.error) &&
      Number.isInteger(v.error.code) &&
      (v.error.name === null || typeof v.error.name === "string")));

const isExists = (v: unknown): v is Exists =>
  isRecord(v) &&
  typeof v.instruction === "string" &&
  typeof v.account === "string" &&
  (v.address === undefined || typeof v.address === "string");

/** An account reading as the cards draw it */
const isReading = (v: unknown): v is AccountReading =>
  isRecord(v) &&
  typeof v.name === "string" &&
  typeof v.address === "string" &&
  typeof v.size === "number" &&
  isRecord(v.fields) &&
  Object.values(v.fields).every((f) => typeof f === "string");

/**
 * A result is kept as it was saved once its act and `ok` are sound: the run
 * tickets own its other fields, and the cards read them by act. The
 * exceptions are what `judgeGoal` reads: a call's `called`, which comes back
 * as no call when it is missing or does not read as one, and a failed call's
 * `refused` and `exists`, each dropped when it does not read as one, so the judge can
 * trust the type. A landed run's or call's `signatures` and `line`, which
 * the finish card draws, come back empty when they do not read as theirs,
 * and its `receipt` keeps only the fields that do, so the card can trust
 * them too. A landed airdrop whose `balance` or `airdropped` is not a count
 * of lamports is dropped: `airdropped === 0` decides whether a later card
 * shows, and the record prints both.
 */
const parseResult = (v: unknown): RunResult | null => {
  if (
    !isRecord(v) ||
    !ACTS.includes(v.act as Act) ||
    typeof v.ok !== "boolean" ||
    !isMs(v.seconds)
  ) {
    return null;
  }
  // A failed build saved before `reason` existed failed in the compiler
  if (
    v.act === "build" &&
    !v.ok &&
    v.reason !== "unreachable" &&
    v.reason !== "signed_out"
  ) {
    return { ...v, reason: "compiler" } as unknown as RunResult;
  }
  if (
    v.act === "airdrop" &&
    v.ok &&
    !(isLamports(v.balance) && isLamports(v.airdropped))
  ) {
    return null;
  }
  if ((v.act === "run" || v.act === "call") && v.ok) {
    const called = Array.isArray(v.called) ? v.called.filter(isCalled) : [];
    const signatures = isStrings(v.signatures) ? v.signatures : [];
    const line = typeof v.line === "string" ? v.line : null;
    const { receipt, account, ...landed } = v;
    // Drawn, never judged: one that does not read as a reading only loses its card
    const rest = isReading(account) ? { ...landed, account } : landed;
    const { receipt: kept, mismatched } = parseReceipt(receipt);
    if (mismatched.length) {
      // Kept as far as it reads: a receipt field is drawn, never judged, so
      // it does not fail the load the way an unreadable entry does
      log.debug("a saved receipt holds fields that do not match its schema", {
        context: { mismatched },
      });
    }
    return (kept
      ? { ...rest, signatures, line, called, receipt: kept }
      : { ...rest, signatures, line, called }) as unknown as RunResult;
  }
  if (
    (v.act === "run" || v.act === "call") &&
    ("refused" in v || "exists" in v)
  ) {
    const { refused, exists, ...rest } = v;
    return Object.assign(
      rest,
      isRefusal(refused) ? { refused } : {},
      isExists(exists) ? { exists } : {}
    ) as unknown as RunResult;
  }
  return v as unknown as RunResult;
};

/**
 * A receipt as the finish card draws it. Every field is optional: the call
 * runner (task 4.3) fills what it can.
 */
const receiptSchema = z.object({
  fee: z.number().int().nonnegative().optional(),
  signer: z.string().optional(),
  accounts: z
    .array(z.object({ name: z.string(), address: z.string() }))
    .optional(),
  log: z.array(z.string()).optional(),
  computeUnits: z.number().int().nonnegative().optional(),
});

/**
 * The receipt's fields that match `receiptSchema`, or null when it is not an
 * object or none is left. What does not match costs only itself: a field, or
 * one entry of a list. `mismatched` names each such path (`accounts.1`), for
 * the caller to log.
 */
const parseReceipt = (
  v: unknown
): { receipt: Receipt | null; mismatched: string[] } => {
  if (!isRecord(v)) {
    return { receipt: null, mismatched: v === undefined ? [] : ["receipt"] };
  }
  const first = receiptSchema.safeParse(v);
  const mismatched = first.success
    ? []
    : first.error.issues.map((issue) => issue.path.join("."));
  const parsed = first.success
    ? first.data
    : receiptSchema.parse(withoutPaths(v, first.error.issues));
  const out: Receipt = {};
  if (parsed.fee !== undefined) out.fee = parsed.fee;
  if (parsed.signer !== undefined) out.signer = parsed.signer;
  if (parsed.accounts?.length) out.accounts = parsed.accounts;
  if (parsed.log?.length) out.log = parsed.log;
  if (parsed.computeUnits !== undefined) out.computeUnits = parsed.computeUnits;
  return {
    receipt: Object.keys(out).length ? out : null,
    mismatched,
  };
};

/**
 * The receipt without what its issues point at: a list entry where the
 * issue names one, else the whole field
 */
const withoutPaths = (
  v: Record<string, unknown>,
  issues: readonly { path: readonly PropertyKey[] }[]
): Record<string, unknown> => {
  const out: Record<string, unknown> = Object.assign({}, v);
  const entries = new Map<string, Set<number>>();
  for (const { path } of issues) {
    const [field, index] = path;
    if (typeof field !== "string") continue;
    if (typeof index === "number" && Array.isArray(out[field])) {
      const set = entries.get(field) ?? new Set<number>();
      set.add(index);
      entries.set(field, set);
    } else {
      delete out[field];
    }
  }
  for (const [field, drop] of entries) {
    const list = out[field];
    if (Array.isArray(list)) out[field] = list.filter((_, i) => !drop.has(i));
  }
  return out;
};

/** A run saved as `started` comes back `interrupted`: nothing resumes */
const parseRun = (v: unknown): RunRecord | null => {
  if (!isRecord(v) || !isMs(v.at)) return null;
  const at = v.at;
  switch (v.status) {
    case "started":
    case "interrupted":
      return { status: "interrupted", at };
    case "ok": {
      const result = parseResult(v.result);
      return result && isMs(v.took)
        ? { status: "ok", at, took: v.took, result }
        : null;
    }
    case "refused": {
      // Only a failed call that carries its refusal or an existing account
      // was ever recorded refused
      const result = parseResult(v.result);
      return result &&
        isMs(v.took) &&
        !result.ok &&
        (result.act === "run" || result.act === "call") &&
        (result.refused || existsOf(result))
        ? { status: "refused", at, took: v.took, result }
        : null;
    }
    case "failed": {
      const result = parseResult(v.result);
      if (!result || !isMs(v.took)) return null;
      const run: RunRecord = { status: "failed", at, took: v.took, result };
      if (v.planned === true) run.planned = true;
      // The explain's moments, each kept only when it reads as a time
      if (isMs(v.explainedAt)) run.explainedAt = v.explainedAt;
      if (isMs(v.answeredAt)) run.answeredAt = v.answeredAt;
      if (isMs(v.fixedAt)) run.fixedAt = v.fixedAt;
      return run;
    }
    default:
      return null;
  }
};

/** An act's runs, the unreadable ones dropped; none left drops the act */
const parseRuns = (
  v: unknown,
  onDrop: (key: string) => void,
  key: string
): RunRecord[] | null => {
  if (!Array.isArray(v)) return null;
  const runs: RunRecord[] = [];
  v.forEach((entry, i) => {
    const run = parseRun(entry);
    if (run) runs.push(run);
    else onDrop(`${key}[${i}]`);
  });
  return runs.length ? runs : null;
};

const parseEach = <T>(
  v: unknown,
  parse: (entry: unknown, key: string) => T | null,
  onDrop: (key: string) => void,
  section: string
): Record<string, T> => {
  if (!isRecord(v)) return {};
  const out: Record<string, T> = {};
  for (const [id, entry] of Object.entries(v)) {
    const key = `${section}.${id}`;
    const parsed = parse(entry, key);
    if (parsed !== null) out[id] = parsed;
    else onDrop(key);
  }
  return out;
};

/** A composer record as saved: `Said` */
const saidSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["word", "refused"]),
    text: z.string().min(1),
    at: z.number(),
  }),
  z.object({
    kind: z.literal("chip"),
    index: z.number().int().nonnegative(),
    at: z.number(),
  }),
]);

/** A proposal as saved: `Proposal` */
const proposalSchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().positive(),
  before: z.string(),
  after: z.string(),
  at: z.number(),
  state: z.enum(["open", "applied", "kept"]),
  settledAt: z.number().optional(),
  applyFailed: z.enum(["moved", "gone", "write"]).optional(),
});

const parseSaid = (v: unknown): Said | null => {
  const parsed = saidSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
};

const parseProposal = (v: unknown): Proposal | null => {
  const parsed = proposalSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
};

/** A list added after version 1 shipped: absent reads as empty, and an
 * unreadable entry is dropped and reported by its index */
const parseList = <T>(
  v: unknown,
  parse: (entry: unknown) => T | null,
  onDrop: (key: string) => void,
  section: string
): T[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    onDrop(section);
    return [];
  }
  const out: T[] = [];
  v.forEach((entry, i) => {
    const parsed = parse(entry);
    if (parsed !== null) out.push(parsed);
    else onDrop(`${section}[${i}]`);
  });
  return out;
};

const VIAS: readonly PassedVia[] = ["chat", "client", "call_panel"];

const parseTime = (v: unknown): StepTime | null => {
  if (!isRecord(v) || !isMs(v.from) || !isMsOrNull(v.to)) return null;
  const time: StepTime = { from: v.from, to: v.to };
  if (VIAS.includes(v.via as PassedVia)) time.via = v.via as PassedVia;
  if (v.reason === "exists") time.reason = "exists";
  return time;
};

/**
 * The saved `conversation`, or null when it is not a version 1 save. A null
 * opens the tutorial on the intro and, through the store's `loadFailed`
 * guard, keeps the file unwritten for the rest of that load: the learner's
 * actions live in memory only, and only Start over writes over a save that
 * could not be read. Entries it cannot read are dropped one by one, each
 * reported to `onDrop` by its key, so the store can log what the save lost.
 */
export const parseProgress = (
  saved: unknown,
  onDrop: (key: string) => void = () => {}
): ConversationProgress | null => {
  if (!isRecord(saved) || saved.version !== 1) return null;
  if (!isStrings(saved.passed) || !isMsOrNull(saved.finishedAt)) return null;
  const cursor = parseCursor(saved.cursor);
  if (!cursor) return null;
  if (!isMsOrNull(saved.startedAt)) return null;
  // One rule for the save's timestamps: a malformed one fails the save
  if (!isMsOrNull(saved.restartedAt)) return null;
  const restartedAt = saved.restartedAt;

  const deployed = parseDeployed(saved.deployed);
  if (saved.deployed !== undefined && !deployed) onDrop("deployed");
  return {
    version: 1,
    passed: Array.from(new Set(saved.passed)),
    finishedAt: saved.finishedAt,
    startedAt: saved.startedAt,
    restartedAt,
    cursor,
    beats: parseEach(saved.beats, parseResolution, onDrop, "beats"),
    runs: parseEach(
      saved.runs,
      (entry, key) => parseRuns(entry, onDrop, key),
      onDrop,
      "runs"
    ),
    times: parseEach(saved.times, parseTime, onDrop, "times"),
    said: parseList(saved.said, parseSaid, onDrop, "said"),
    proposals: parseList(saved.proposals, parseProposal, onDrop, "proposals"),
    accounts: parseEach(
      saved.accounts,
      (entry) => (typeof entry === "string" ? entry : null),
      onDrop,
      "accounts"
    ),
    ...(deployed ? { deployed } : {}),
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/tutorial-conversation/model/progress", () => {
    it("drops a landed airdrop whose balance or amount does not read as lamports", () => {
      const saved = (balance: unknown, airdropped: unknown) =>
        JSON.parse(
          JSON.stringify(
            Object.assign(freshProgress(), {
              runs: {
                "s2.airdrop": [
                  {
                    status: "ok",
                    at: 1,
                    took: 1,
                    result: {
                      act: "airdrop",
                      ok: true,
                      seconds: 1,
                      balance,
                      airdropped,
                    },
                  },
                ],
              },
            })
          )
        );
      const run = (v: unknown) => parseProgress(v)?.runs["s2.airdrop"]?.[0];
      expect(run(saved(3_000_000_000, 0))).toMatchObject({
        result: { balance: 3_000_000_000, airdropped: 0 },
      });
      expect(run(saved("3", 0))).toBeUndefined();
      expect(run(saved(3_000_000_000, undefined))).toBeUndefined();
      expect(run(saved(1, -1))).toBeUndefined();
      expect(run(saved(1.5, 0))).toBeUndefined();
    });

    it("keeps a sound account reading and drops one it cannot read", () => {
      const saved = (account: unknown) =>
        JSON.parse(
          JSON.stringify(
            Object.assign(freshProgress(), {
              runs: {
                chop: [
                  {
                    status: "ok",
                    at: 1,
                    took: 1,
                    result: {
                      act: "call",
                      ok: true,
                      seconds: 1,
                      signatures: [],
                      line: null,
                      called: [],
                      account,
                    },
                  },
                ],
              },
            })
          )
        );
      const reading = {
        name: "player",
        address: "P",
        size: 32,
        fields: { wood: "1" },
      };
      const run = (v: unknown) => parseProgress(v)?.runs.chop?.[0];
      expect(run(saved(reading))).toMatchObject({
        result: { account: reading },
      });
      expect(run(saved({ name: "player" }))).not.toHaveProperty(
        "result.account"
      );
    });

    it("keeps the remembered accounts across a reload, and reads an older save as none", () => {
      const fresh = freshProgress();
      expect(fresh.accounts).toEqual({});
      const saved = JSON.parse(
        JSON.stringify(Object.assign(fresh, { accounts: { map: "Map1" } }))
      );
      expect(parseProgress(saved)?.accounts).toEqual({ map: "Map1" });
      delete saved.accounts;
      expect(parseProgress(saved)?.accounts).toEqual({});
    });

    it("keeps the deployed IDL across a reload, and drops one it cannot read", () => {
      const idl = { instructions: [{ name: "hello", accounts: [], args: [] }] };
      const dropped: string[] = [];
      const saved = JSON.parse(JSON.stringify(freshProgress()));
      saved.deployed = { idl, added: ["hello"] };
      expect(parseProgress(saved)?.deployed).toEqual({
        idl,
        added: ["hello"],
      });
      saved.deployed = { idl: {} };
      expect(parseProgress(saved, (k) => dropped.push(k))?.deployed).toBe(
        undefined
      );
      expect(dropped).toEqual(["deployed"]);
    });

    it("drops a remembered account it cannot read, by its key", () => {
      const dropped: string[] = [];
      const saved = JSON.parse(JSON.stringify(freshProgress()));
      saved.accounts = { map: "Map1", big_map: 7 };
      expect(parseProgress(saved, (k) => dropped.push(k))?.accounts).toEqual({
        map: "Map1",
      });
      expect(dropped).toEqual(["accounts.big_map"]);
    });

    const STEPS = ["write-program", "deploy", "call-client", "greet-by-name"];

    /**
     * A save midway through step 2, built field by field. The optional
     * `extra` entries are the unreadable ones a test adds; `passed` and
     * `finishedAt` the ones a test overrides.
     */
    const midway = (
      opts: {
        passed?: string[];
        finishedAt?: number | null;
        beats?: Record<string, unknown>;
        runs?: Record<string, unknown>;
        times?: Record<string, unknown>;
        said?: unknown[];
        proposals?: unknown[];
      } = {}
    ) => ({
      version: 1 as const,
      passed: opts.passed ?? ["write-program"],
      finishedAt: opts.finishedAt ?? null,
      startedAt: 1000,
      restartedAt: null,
      cursor: { kind: "step" as const, stepId: "deploy", beat: 2, fail: false },
      beats: Object.assign(
        {
          "s1.boil": {
            kind: "written",
            at: 1100,
            wrote: { file: "src/lib.rs", lines: [1, 2, 3] },
          },
          "s1.what": { kind: "said", at: 1200 },
          "s1.q1": {
            kind: "picked",
            at: 1300,
            openedAt: 1250,
            option: 1,
            attempts: 2,
            wrong: [0],
            wrote: {
              file: "src/lib.rs",
              lines: [5, 6, 7, 8, 9, 10, 11, 12, 13],
              appended: true,
            },
          },
          // The live assistant's hint: no I'm stuck pill, on reload too
          "s2.q2": {
            kind: "open",
            at: 2000,
            wrong: [1],
            hintedAt: 2050,
            hintByAssistant: true,
          },
        },
        opts.beats
      ),
      runs: Object.assign(
        {
          "s1.build": [
            {
              status: "failed",
              at: 1350,
              took: 1000,
              result: {
                act: "build",
                ok: false,
                seconds: 1,
                reason: "compiler",
                error: null,
                log: "",
              },
            },
            {
              status: "ok",
              at: 1400,
              took: 1600,
              result: {
                act: "build",
                ok: true,
                seconds: 1.6,
                instructions: ["hello"],
              },
            },
          ],
        },
        opts.runs
      ),
      times: Object.assign(
        {
          "write-program": { from: 1000, to: 1500, via: "chat" },
          deploy: { from: 1500, to: null },
        },
        opts.times
      ),
      said: opts.said ?? [],
      proposals: opts.proposals ?? [],
      accounts: {},
    });

    /** Through JSON, as the file holds it */
    const reload = (p: unknown) => parseProgress(JSON.parse(JSON.stringify(p)));

    it("parses a fresh save to itself", () => {
      expect(reload(freshProgress())).toEqual(freshProgress());
    });

    it("parses a midway save to itself", () => {
      expect(reload(midway())).toEqual(midway());
    });

    it("keeps a block's written text across a reload, and reads a save without it as before", () => {
      const text = ["use anchor_lang::prelude::*;", "", 'declare_id!("1");'];
      const withText = midway({
        beats: {
          "s1.boil": {
            kind: "written",
            at: 1100,
            wrote: { file: "src/lib.rs", lines: [1, 2, 3], text },
          },
        },
      });
      expect(reload(withText)?.beats["s1.boil"]).toEqual(
        withText.beats["s1.boil"]
      );
      // A resolved question's block keeps its text too
      const q1 = {
        kind: "picked",
        at: 1300,
        openedAt: 1250,
        option: 1,
        attempts: 1,
        wrong: [],
        wrote: { file: "src/lib.rs", lines: [5], text: ["fn hi() {}"] },
      };
      expect(
        reload(midway({ beats: { "s1.q1": q1 } }))?.beats["s1.q1"]
      ).toEqual(q1);
      // A save from before the text was kept: no text, the card reads the file
      expect(reload(midway())?.beats["s1.boil"]).toEqual({
        kind: "written",
        at: 1100,
        wrote: { file: "src/lib.rs", lines: [1, 2, 3] },
      });
    });

    it("drops text it cannot pair with the lines, and keeps the block", () => {
      const landed = (text: unknown) =>
        reload(
          midway({
            beats: {
              "s1.boil": {
                kind: "written",
                at: 1100,
                wrote: { file: "src/lib.rs", lines: [1, 2], text },
              },
            },
          })
        )?.beats["s1.boil"];
      const block = {
        kind: "written",
        at: 1100,
        wrote: { file: "src/lib.rs", lines: [1, 2] },
      };
      expect(landed(["only one"])).toEqual(block);
      expect(landed([1, 2])).toEqual(block);
      expect(landed("a\nb")).toEqual(block);
    });

    it("keeps a landed airdrop across a reload, so its card is not live again", () => {
      const landed = Object.assign(freshProgress(), {
        runs: {
          "s2.airdrop": [
            {
              status: "ok",
              at: 5000,
              took: 2000,
              result: {
                act: "airdrop",
                ok: true,
                seconds: 2,
                balance: 2_000_000_000,
                airdropped: 0,
              },
            },
          ],
        },
      });
      expect(reload(landed)?.runs["s2.airdrop"]).toEqual(
        landed.runs["s2.airdrop"]
      );
    });

    it("is null for another version, a bad field or a missing cursor", () => {
      expect(parseProgress(undefined)).toBeNull();
      expect(
        parseProgress(Object.assign(freshProgress(), { version: 2 }))
      ).toBeNull();
      expect(
        parseProgress({ version: 1, passed: [], finishedAt: null })
      ).toBeNull();
      expect(
        parseProgress(Object.assign(freshProgress(), { passed: "x" }))
      ).toBeNull();
    });

    it("reads a failed build saved before its reason as a compiler failure", () => {
      const before: RunRecord = {
        status: "failed",
        at: 1,
        took: 2,
        result: {
          act: "build",
          ok: false,
          seconds: 2,
          error: null,
          log: "x",
        } as unknown as RunResult,
      };
      const unreachable: RunResult = {
        act: "build",
        ok: false,
        seconds: 0,
        reason: "unreachable",
        error: null,
        log: "down",
      };
      const saved = midway({
        runs: {
          "s1.build": [
            before,
            { status: "failed", at: 3, took: 0, result: unreachable },
          ],
        },
      });
      const runs = reload(saved)?.runs["s1.build"];
      expect(runs?.map((r) => "result" in r && r.result)).toEqual([
        {
          act: "build",
          ok: false,
          seconds: 2,
          reason: "compiler",
          error: null,
          log: "x",
        },
        unreachable,
      ]);
    });

    it("keeps a build refused for sign-in on load, never a compiler failure", () => {
      const refused: RunResult = {
        act: "build",
        ok: false,
        seconds: 0,
        reason: "signed_out",
        error: null,
        log: "Sign in with GitHub to build.",
      };
      const saved = midway({
        runs: {
          "s1.build": [{ status: "failed", at: 3, took: 0, result: refused }],
        },
      });
      const runs = reload(saved)?.runs["s1.build"];
      expect(runs?.map((r) => "result" in r && r.result)).toEqual([refused]);
      expect(isSignedOut(refused)).toBe(true);
      expect(isUnreachable(refused)).toBe(false);
    });

    it("reloads an explained failure's moments, and drops one that is not a time", () => {
      const result: RunResult = {
        act: "build",
        ok: false,
        seconds: 1,
        reason: "compiler",
        error: null,
        log: "x",
      };
      const kept: RunRecord = {
        status: "failed",
        at: 1,
        took: 2,
        result,
        explainedAt: 4,
        answeredAt: 5,
        fixedAt: 6,
      };
      const broken = {
        status: "failed",
        at: 7,
        took: 2,
        result,
        explainedAt: 8,
        answeredAt: "soon",
      };
      const saved = midway({ runs: { "s1.build": [kept, broken] } });
      expect(reload(saved)?.runs["s1.build"]).toEqual([
        kept,
        { status: "failed", at: 7, took: 2, result, explainedAt: 8 },
      ]);
    });

    it("turns a started run into an interrupted one", () => {
      const saved = midway({
        runs: { "s2.deploy": [{ status: "started", at: 2100 }] },
      });
      expect(reload(saved)?.runs["s2.deploy"]).toEqual([
        { status: "interrupted", at: 2100 },
      ]);
    });

    it("reloads a refused run as refused, and drops a refusal it cannot read", () => {
      const refused: RunRecord = {
        status: "refused",
        at: 3000,
        took: 900,
        result: {
          act: "call",
          ok: false,
          seconds: 0.9,
          message: "Not enough energy",
          log: "Program log: AnchorError ... Error Number: 6000.",
          refused: {
            instruction: "chop_tree",
            error: { code: 6000, name: "NotEnoughEnergy" },
          },
        },
      };
      const panicked: RunRecord = {
        status: "failed",
        at: 4000,
        took: 900,
        result: {
          act: "call",
          ok: false,
          seconds: 0.9,
          message: "SBF program panicked",
          log: "Program log: Error: memory allocation failed, out of memory",
          refused: { instruction: "grow", error: null },
        },
      };
      const saved = midway({ runs: { "s3.chop": [refused, panicked] } });
      expect(reload(saved)?.runs["s3.chop"]).toEqual([refused, panicked]);

      // A refused record holds a failed call with its refusal, or nothing
      const notRefused = midway({
        runs: {
          "s3.chop": [
            {
              status: "refused",
              at: 3000,
              took: 900,
              result: {
                act: "call",
                ok: false,
                seconds: 1,
                message: "x",
                log: "",
              },
            },
          ],
        },
      });
      expect(reload(notRefused)?.runs["s3.chop"]).toBeUndefined();

      const garbled = midway({
        runs: {
          "s3.chop": [
            {
              status: "failed",
              at: 4000,
              took: 900,
              result: {
                act: "call",
                ok: false,
                seconds: 0.9,
                message: "x",
                log: "",
                refused: { instruction: "chop_tree", error: { code: "6000" } },
              },
            },
          ],
        },
      });
      expect(reload(garbled)?.runs["s3.chop"]).toEqual([
        {
          status: "failed",
          at: 4000,
          took: 900,
          result: {
            act: "call",
            ok: false,
            seconds: 0.9,
            message: "x",
            log: "",
          },
        },
      ]);
    });

    it("reloads a pass on an existing account: its record and its reason", () => {
      const exists: RunRecord = {
        status: "refused",
        at: 2000,
        took: 900,
        result: {
          act: "run",
          ok: false,
          seconds: 0.9,
          reason: "no_transaction",
          message: "client.ts sent no transaction. See the terminal.",
          log: "",
          exists: {
            instruction: "init_player",
            account: "player",
            address: "Player1",
          },
        },
      };
      const saved = midway({
        runs: { "s2.run": [exists] },
        times: {
          deploy: { from: 1500, to: 2900, via: "client", reason: "exists" },
        },
      });
      const reloaded = reload(saved);
      expect(reloaded?.runs["s2.run"]).toEqual([exists]);
      expect(reloaded?.times.deploy).toEqual({
        from: 1500,
        to: 2900,
        via: "client",
        reason: "exists",
      });
    });

    it("drops the entries it cannot read, names each, and keeps the rest", () => {
      const saved = midway({
        beats: {
          "s2.why": { kind: "sung", at: 1 },
          "s2.q9": { kind: "picked", at: 1 },
          "s2.q8": {
            kind: "skipped",
            at: 1,
            openedAt: 1,
            via: "magic",
            wrong: [],
          },
        },
        runs: {
          "s2.deploy": [
            { status: "ok", at: 1, took: 1, result: { act: "fly" } },
          ],
          "s3.run": { status: "ok", at: 1, took: 1 },
          "s4.call": [
            { status: "interrupted", at: 1 },
            {
              status: "ok",
              at: 2,
              took: "1.6",
              result: { act: "call", ok: true, seconds: 1 },
            },
          ],
        },
        times: { broken: { from: "yesterday" } },
      });
      const dropped: string[] = [];
      const kept = midway({
        runs: { "s4.call": [{ status: "interrupted", at: 1 }] },
      });
      expect(
        parseProgress(JSON.parse(JSON.stringify(saved)), (k) => dropped.push(k))
      ).toEqual(kept);
      expect(dropped).toEqual([
        "beats.s2.why",
        "beats.s2.q9",
        "beats.s2.q8",
        "runs.s2.deploy[0]",
        "runs.s2.deploy",
        "runs.s3.run",
        "runs.s4.call[1]",
        "times.broken",
      ]);
    });

    it("reads a save from before the composer's records as having none", () => {
      const before: Record<string, unknown> = midway();
      delete before.said;
      delete before.proposals;
      const dropped: string[] = [];
      expect(
        parseProgress(JSON.parse(JSON.stringify(before)), (k) =>
          dropped.push(k)
        )
      ).toEqual(midway());
      expect(dropped).toEqual([]);
    });

    it("keeps the composer's records, and drops the ones it cannot read", () => {
      const word = { kind: "word", text: "build", at: 3000 };
      const refused = { kind: "refused", text: "deploy please", at: 3100 };
      const chip = { kind: "chip", index: 1, at: 9000 };
      const applied = {
        id: "p1",
        file: "programs/hello/src/lib.rs",
        line: 10,
        before: '        msg!("Hello, {}!", name);',
        after: '        msg!("Once upon a time on devnet");',
        at: 9100,
        state: "applied",
      };
      const failed = {
        id: "p2",
        file: "programs/hello/src/lib.rs",
        line: 10,
        before: "",
        after: "// one more",
        at: 9200,
        state: "open",
        applyFailed: "write",
      };
      const saved = midway({
        said: [
          word,
          { kind: "word", text: "", at: 1 },
          refused,
          { kind: "chip", index: -1, at: 1 },
          chip,
        ],
        proposals: [applied, { id: "p3", file: "x", line: 0 }, failed],
      });
      const dropped: string[] = [];
      expect(
        parseProgress(JSON.parse(JSON.stringify(saved)), (k) => dropped.push(k))
      ).toEqual(
        midway({ said: [word, refused, chip], proposals: [applied, failed] })
      );
      expect(dropped).toEqual(["said[1]", "said[3]", "proposals[1]"]);
      const notAList = midway();
      (notAList as { said: unknown }).said = "build";
      const named: string[] = [];
      expect(
        parseProgress(JSON.parse(JSON.stringify(notAList)), (k) =>
          named.push(k)
        )?.said
      ).toEqual([]);
      expect(named).toEqual(["said"]);
    });

    it("keeps a restart time and a question skipped from elsewhere, and refuses a malformed restart time", () => {
      const restarted = midway({
        beats: {
          "s2.q2": {
            kind: "skipped",
            at: 2800,
            openedAt: 2700,
            via: "elsewhere",
            wrong: [],
          },
        },
      });
      (restarted as { restartedAt: number | null }).restartedAt = 7000;
      expect(reload(restarted)).toEqual(restarted);
      const bad = midway();
      (bad as { restartedAt: unknown }).restartedAt = "yesterday";
      expect(reload(bad)).toBeNull();
    });

    it("reads a call's `called` back, and an unreadable one as no calls", () => {
      const ok = (called: unknown) => ({
        status: "ok",
        at: 1,
        took: 1,
        result: {
          act: "call",
          ok: true,
          seconds: 1,
          signatures: ["sig"],
          line: null,
          called,
        },
      });
      const calledOf = (called: unknown) => {
        const run = reload(midway({ runs: { "s4.call": [ok(called)] } }))?.runs[
          "s4.call"
        ][0];
        return run?.status === "ok" &&
          run.result.act === "call" &&
          run.result.ok
          ? run.result.called
          : "not read";
      };
      const hello = { instruction: "hello", args: { name: "Alex" } };
      expect(calledOf([hello])).toEqual([hello]);
      // Saved before the field existed
      expect(calledOf(undefined)).toEqual([]);
      expect(calledOf({})).toEqual([]);
      // Only the entries that read as calls are kept
      expect(
        calledOf([
          hello,
          { instruction: "hello" },
          { instruction: "x", args: { n: 1 } },
        ])
      ).toEqual([hello]);
    });

    it("reads back only what a landed call's receipt rows can draw", () => {
      /** The landed call `s4.call` saved with these result fields, read back */
      const landed = (fields: Record<string, unknown>) =>
        reload(
          midway({
            runs: {
              "s4.call": [
                {
                  status: "ok",
                  at: 1,
                  took: 1,
                  result: Object.assign(
                    { act: "call", ok: true, seconds: 1, called: [] },
                    fields
                  ),
                },
              ],
            },
          })
        )?.runs["s4.call"][0];

      // A corrupt signature list or line would throw in the finish card
      expect(landed({ signatures: "5ig", line: 7 })).toMatchObject({
        result: { signatures: [], line: null },
      });
      expect(landed({})).toMatchObject({
        result: { signatures: [], line: null },
      });
      // Nothing of the receipt reads as its own: no receipt at all
      const bare = landed({
        signatures: ["5ig"],
        line: null,
        receipt: { fee: -1, accounts: [7], log: [1] },
      });
      expect(bare?.status).toBe("ok");
      expect(bare?.status === "ok" && "receipt" in bare.result).toBe(false);
      // Each field stands alone: a log that is not lines, or an account
      // that is not one, goes, and the rest of the receipt stays
      const kept = landed({
        signatures: ["sig"],
        line: null,
        receipt: {
          fee: 5000,
          signer: "Wa11et",
          accounts: [{ name: "program", address: "Pr0g" }, 7],
          log: "not lines",
        },
      });
      expect(
        kept?.status === "ok" && "receipt" in kept.result
          ? kept.result.receipt
          : "no receipt"
      ).toEqual({
        fee: 5000,
        signer: "Wa11et",
        accounts: [{ name: "program", address: "Pr0g" }],
      });
      // One bad log line costs only itself
      expect(
        landed({
          signatures: ["5ig"],
          line: null,
          receipt: { fee: 0.5, log: ["Program log: Hello, Alex!", 3] },
        })
      ).toMatchObject({
        result: { receipt: { log: ["Program log: Hello, Alex!"] } },
      });
    });

    it("keeps a receipt's compute units across a reload", () => {
      expect(parseReceipt({ fee: 5000, computeUnits: 389 })).toEqual({
        receipt: { fee: 5000, computeUnits: 389 },
        mismatched: [],
      });
      expect(parseReceipt({ computeUnits: -1 })).toEqual({
        receipt: null,
        mismatched: ["computeUnits"],
      });
    });

    it("names each receipt path its schema does not match, for the log", () => {
      expect(
        parseReceipt({
          fee: -1,
          signer: "Wa11et",
          accounts: [{ name: "program", address: "Pr0g" }, 7],
          log: "not lines",
        })
      ).toEqual({
        receipt: {
          signer: "Wa11et",
          accounts: [{ name: "program", address: "Pr0g" }],
        },
        mismatched: ["fee", "accounts.1", "log"],
      });
      expect(parseReceipt(undefined)).toEqual({
        receipt: null,
        mismatched: [],
      });
      expect(parseReceipt("receipt")).toEqual({
        receipt: null,
        mismatched: ["receipt"],
      });
    });

    it("keeps a passed step once", () => {
      expect(reload(midway({ passed: ["a", "a", "b"] }))?.passed).toEqual([
        "a",
        "b",
      ]);
    });

    // The card's reader (`conversationProgressOf`, `entities/tutorial`) is
    // not called here: the entity's barrel loads UI that reads the build's
    // globals on import. `ConversationProgress extends ConversationSave`
    // holds the shape by type; this pins the two fields it reads at runtime.
    it("keeps the fields the card reads", () => {
      const half = reload(midway());
      expect(half?.passed).toEqual(["write-program"]);
      expect(half?.finishedAt).toBeNull();
      const done = reload(midway({ passed: STEPS, finishedAt: 9000 }));
      expect(done?.passed).toEqual(STEPS);
      expect(done?.finishedAt).toBe(9000);
    });
  });
}
