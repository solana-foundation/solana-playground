/* eslint-disable max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type {
  AccountView,
  Act,
  ActBeat,
  Ask,
  Beat,
  Chip,
  Follow,
  Goal,
  QuestionResult,
  Quote,
  Step,
  Text,
  TutorialDefinition,
  Win,
} from "@/entities/tutorial";

import { latestReading } from "./account-view";
import { FINISH_DELAY_MS } from "./clock";
import { goalGap } from "./goals";
import type {
  AccountReading,
  ConversationProgress,
  PassedVia,
  Proposal,
  Resolution,
  RunRecord,
  RunResult,
  Wrote,
} from "./progress";
import { answerOf, isMismatch } from "./progress";
import type { EngineState, Stage } from "./reducer";
import { hasRepeatEnded } from "./reducer";
import { wordOf } from "./route";
import { MISMATCH } from "./runners/run-call";

/**
 * The feed as a fold over the definition and the saved progress. The save
 * holds facts; every word here comes from the definition, so a fixed typo
 * shows on reload. The feed (task 3.3) renders these turns and nothing
 * else; the cards dispatch actions and never compute state of their own.
 */

/** A `run` or `call` act that landed: the result a receipt is read from */
export type LandedCall = Extract<RunResult, { act: "run" | "call"; ok: true }>;

/**
 * The last step's latest landed `run` or `call` act, or null: the spec's
 * "last call's receipt". Only the act cards record runs, so a last step
 * passed from the Call panel or a client run outside the feed leaves none,
 * and an earlier step's transaction is never shown in its place.
 */
const lastLandedCall = (
  definition: TutorialDefinition,
  p: ConversationProgress
): LandedCall | null => {
  const last = definition.steps[definition.steps.length - 1];
  const acts = [...last.beats, ...(last.onFail ?? [])]
    .filter((b) => b.kind === "act")
    .map((b) => b.id);
  let latest: { at: number; result: LandedCall } | null = null;
  for (const id of acts) {
    for (const run of p.runs[id] ?? []) {
      const r = run.status === "ok" ? run.result : null;
      if (!r || (r.act !== "run" && r.act !== "call") || !r.ok) continue;
      if (!latest || run.at >= latest.at) latest = { at: run.at, result: r };
    }
  }
  return latest?.result ?? null;
};

/** The step a moment belongs to: the last one entered by then, or null */
const stepAt = (
  definition: TutorialDefinition,
  p: ConversationProgress,
  at: number
): string | null => {
  let found: { id: string; from: number } | null = null;
  for (const step of definition.steps) {
    const time = p.times[step.id];
    // Strictly before: a record at the moment a step began is the word that
    // began it, typed in the step before
    if (time && time.from < at && (!found || time.from >= found.from)) {
      found = { id: step.id, from: time.from };
    }
  }
  return found?.id ?? null;
};

/**
 * The composer's records as turns: a word's pill (the act it ran draws its
 * own card), a refused word's pill and the lesson's answer, a finish chip's
 * label and answer, and each proposal's apply card, with a wrote card once
 * it was applied
 */
const composerTurns = (
  definition: TutorialDefinition,
  p: ConversationProgress
): Posted[] => {
  const out: Posted[] = [];
  p.said.forEach((said, i) => {
    const step = stepAt(definition, p, said.at);
    if (said.kind === "chip") {
      const chip = definition.finish.chips[said.index];
      if (!chip) return;
      out.push(
        {
          id: `said:${i}`,
          kind: "you",
          step: null,
          at: said.at,
          text: chip.label,
          code: false,
        },
        {
          id: `reply:${i}`,
          kind: "reply",
          step: null,
          at: said.at,
          text: chip.answer,
          follow: chip.follow ?? null,
        }
      );
      return;
    }
    // "explain" runs Explain the error, which echoes the learner itself
    if (said.kind === "word" && wordOf(said.text) === "explain") return;
    out.push({
      id: `said:${i}`,
      kind: "you",
      step,
      at: said.at,
      text: said.text,
      code: false,
    });
    if (said.kind === "refused") {
      out.push({
        id: `reply:${i}`,
        kind: "reply",
        step,
        at: said.at,
        text: PICK_FIRST,
        follow: null,
      });
    }
  });
  for (const proposal of p.proposals) {
    const step = stepAt(definition, p, proposal.at);
    out.push({
      id: `apply:${proposal.id}`,
      kind: "apply",
      step,
      at: proposal.at,
      proposal,
    });
    if (proposal.state === "applied") {
      out.push({
        id: `wrote:${proposal.id}`,
        kind: "wrote",
        step,
        at: proposal.settledAt ?? proposal.at,
        beatId: proposal.id,
        wrote: { file: proposal.file, lines: [proposal.line] },
        failed: false,
      });
    }
  }
  return out;
};

/** The lesson's answer to an action word typed while a question is open */
export const PICK_FIRST =
  "Pick an answer above first, or press Skip. Then the button's yours.";

/** The learner's pill when they ask for the hint */
export const STUCK = "I'm stuck";
/** The learner's pill on Explain */
export const EXPLAIN = "Explain the error";
/** The act card's line after a reload interrupted its run */
export const INTERRUPTED = "Interrupted by a reload. Run it again.";

/**
 * When "Show me the fix" is offered for an explained failure: once the
 * assistant's answer ended, or at the load that came after the press. The
 * wait for the answer lives in the page, so a reload mid-answer would
 * otherwise never offer it, with the failed card already closed.
 */
const fixOfferAt = (
  run: { explainedAt?: number; answeredAt?: number },
  loadedAt: number
): number | null => {
  if (run.answeredAt !== undefined) return run.answeredAt;
  if (run.explainedAt !== undefined && loadedAt > run.explainedAt) {
    return loadedAt;
  }
  return null;
};

/** The line after the assistant explained an unplanned build failure */
export const FIX_OFFER =
  "Fix it in the editor and build again, or I can show you the lines this step needs.";

/**
 * The line after a call the learner's program could not match (`mismatch` on
 * the result): the offer alone, since the failed card above it already says
 * what to do (Design alignment, 7 Nov)
 */
export const MISMATCH_OFFER = "I can show you the lines this step needs.";

/**
 * The line between a landed result and the live act when the step's goal
 * turned the run down. The prototype never reaches this (tutorial-v2 at
 * f7d42bf2e, `checkOwn` in `store.tsx`): it fails such a build outright, and a
 * real build can succeed without what the step asks for.
 */
export const whyRefused = (goal: Goal, result: RunResult): string => {
  const gap = goalGap(goal, result);
  switch (gap.kind) {
    case "noInstruction":
      return `It built, but the program has no \`${gap.instruction}\` instruction. This step needs one.`;
    case "notCalled":
      return `It ran, but it didn't call \`${gap.instruction}\`. This step needs that call.`;
    case "logDiffers":
      return `It called \`${gap.instruction}\`, but the log isn't the one this step expects.`;
    // No Show me the fix here: a landed run's record has no place to keep it
    case "mismatch":
      return MISMATCH;
    case "other":
      return "It ran, but this step isn't done yet.";
  }
};

/** The button of the act card that runs a failed deploy again */
export const TRY_AGAIN = "Try again";

/** That card's line after the faucet stopped the deploy */
export const ASKS_THE_FAUCET = "Asks the faucet again, then deploys";

/** A deploy the faucet stopped: its card stands for the act that hit it */
const isFaucetRefusal = (result: RunResult): boolean =>
  (result.act === "deploy" || result.act === "buildDeploy") &&
  !result.ok &&
  result.reason === "no_funds";

/**
 * How a failed deploy is run again, as Almaz's prototype draws it
 * (`tutorial-v2` SPEC 6.5.5, "Deploy, no SOL"): a live Try again act card
 * under the result, asking the faucet again after a refusal (`faucet`), or
 * with the act's own line after any other failure (`again`). Null for no
 * wallet, whose result's own Create wallet runs it once the wallet is there,
 * and for every other result.
 * TODO(HOO-2356): the runner's authority and immutable-program refusals are
 * `failed` too, and running again cannot fix them; they need a reason of
 * their own in `RunResult`, as the build's `unreachable` has, before they
 * can go without a Try again.
 */
const retryOf = (result: RunResult): "faucet" | "again" | null => {
  if (isFaucetRefusal(result)) return "faucet";
  if (result.act !== "deploy" && result.act !== "buildDeploy") return null;
  if (!result.ok && result.reason === "failed") return "again";
  return null;
};

/** A failed deploy's act as its Try again card shows it */
const tryAgain = (act: ActBeat, retry: "faucet" | "again" | null): ActBeat =>
  Object.assign({}, act, {
    button: TRY_AGAIN,
    context: retry === "faucet" ? ASKS_THE_FAUCET : act.context,
    // The retry is one press; the card above keeps the others
    repeat: undefined,
  });

/** The assistant's line on Skip when the question has none of its own */
export const SKIPPED_DEFAULT =
  "No problem. Here's the line, and I'll walk you through the rest.";

interface TurnBase {
  /** Stable across reloads: the feed keys on it */
  id: string;
  /** The step the turn belongs to; null for the intro and the finish */
  step: string | null;
  at: number;
  /** Render with no typing or rise: the turn is older than the page load */
  whole: boolean;
}

/** How a resolved question reads in its record (`answerOf`) */
export type AskOutcome = QuestionResult;

/** An act's account view with what to draw it from */
export interface AccountOnCard {
  view: AccountView;
  reading: AccountReading;
}

/** One line of a repeating card */
export interface Press {
  at: number;
  /** Whether the call landed; false is a refusal */
  ok: boolean;
  line: string;
  signature: string | null;
  /** The press's whole result, for the account views (HOO-2506) to read */
  result: RunResult;
}

/**
 * An act card's state. `refused` is a call the program refused as the step's
 * `refused` goal expected: it passed the step, and is no failure to explain.
 */
export type ActState =
  | "live"
  | "running"
  | "done"
  | "refused"
  | "failed"
  | "interrupted";

export type Turn = TurnBase &
  (
    | { kind: "intro" }
    | {
        kind: "divider";
        /** 1-based */
        index: number;
        title: string;
        objective: string;
        done: boolean;
        /** ms, once done */
        took: number | null;
      }
    | {
        kind: "say";
        beatId: string;
        text: Text;
        quote?: Quote;
        /** A quiet button after the line: "Show me the fix", done once used */
        follow?: { kind: "showFix"; done: boolean };
      }
    | { kind: "you"; text: string; code: boolean }
    /** The lesson's own answer to the composer: a refused word, or a finish
     * chip's answer with its quiet button */
    | { kind: "reply"; text: Text; follow: Follow | null }
    /** A change the live assistant proposed, waiting for Apply or Keep it */
    | { kind: "apply"; proposal: Proposal }
    /** A block landed (`wrote`), or could not (`failed`, with `wrote` null) */
    | { kind: "wrote"; beatId: string; wrote: Wrote | null; failed: boolean }
    | {
        kind: "ask";
        beatId: string;
        ask: Ask;
        open: boolean;
        wrong: number[];
        hinted: boolean;
        /** The answer's block could not be written */
        writeFailed: boolean;
        /** Null while open */
        outcome: AskOutcome | null;
        attempts: number;
      }
    | { kind: "hint"; beatId: string; text: Text }
    | {
        kind: "act";
        beatId: string;
        act: ActBeat;
        state: ActState;
        /** A repeating card's lines, oldest first; none on any other card */
        presses: Press[];
        /** The account a live or repeating card draws, once it was read */
        account?: AccountOnCard;
        /** The card's line when the run was interrupted, else null */
        note: string | null;
        stage: Stage | null;
        /** ms, once the run ended */
        took: number | null;
      }
    | {
        kind: "result";
        beatId: string;
        act: Act;
        result: RunResult;
        took: number;
        /** The definition's line for the failure it plans, when this is it */
        planned: Text | null;
        /** A failure still waiting for Explain or "I'll fix it myself" */
        open: boolean;
        /** The account as this run left it */
        account?: AccountOnCard;
      }
    | {
        kind: "win";
        stepId: string;
        win: Win;
        /** Next was pressed, or the finish followed */
        done: boolean;
        took: number;
        via: PassedVia;
        last: boolean;
      }
    | {
        kind: "finish";
        chips: Chip[];
        /** Whole seconds from Start to the finish */
        seconds: number;
        /** The last landed `run` or `call` act, whose receipt the card shows (`lastLandedCall`) */
        receipt: LandedCall | null;
      }
  );

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** A turn before `whole` is stamped on it */
type Posted = DistributiveOmit<Turn, "whole">;

export type StepBarState = "done" | "current" | "not_reached";

export interface StepBarItem {
  id: string;
  short: string;
  title: string;
  state: StepBarState;
  took: number | null;
}

export type Placeholder =
  | "Ask anything about this tutorial"
  | "Ask about this step"
  | "Or ask about this step"
  | "Ask while it builds"
  | "Ask while it runs"
  | "Ask anything";

/** The placeholder while an act runs, by its act (the prototype's `placeholderFor`) */
const WHILE: Record<Act, Placeholder> = {
  build: "Ask while it builds",
  deploy: "Ask while it builds",
  buildDeploy: "Ask while it builds",
  run: "Ask while it runs",
  call: "Ask while it runs",
};

export interface ConversationView {
  turns: Turn[];
  /** The one card that acts; null after the finish, and while the next
   * turn is still on its way */
  live: Turn | null;
  steps: StepBarItem[];
  placeholder: Placeholder;
  /** The earliest `at` still ahead of `now`, so the store can re-render then */
  nextAt: number | null;
  /** When the finish card is due, while the last win is live */
  finishAt: number | null;
}

export interface ViewOptions {
  now: number;
  loadedAt: number;
}

const beatsOf = (step: Step, fail: boolean): Beat[] =>
  fail ? step.onFail ?? [] : step.beats;

const attemptsOf = (r: Resolution): number => {
  if (r.kind === "picked") return r.attempts;
  if (r.kind === "open") return r.wrong.length;
  return 0;
};

/** A run that ended, and so has its time and its result card */
const ended = (
  run: RunRecord
): run is Extract<RunRecord, { status: "ok" | "refused" | "failed" }> =>
  run.status === "ok" || run.status === "refused" || run.status === "failed";

/**
 * One press of a repeating card, as its line reads. A run that failed without
 * a refusal has none: it posts its own failed result card.
 */
const pressOf = (act: ActBeat, run: RunRecord): Press | null => {
  if (
    run.status === "ok" &&
    (run.result.act === "call" || run.result.act === "run") &&
    run.result.ok
  ) {
    return {
      at: run.at,
      ok: true,
      line:
        run.result.line?.replace(/^Program log: /, "") ??
        act.record ??
        "Called",
      signature: run.result.signatures.at(-1) ?? null,
      result: run.result,
    };
  }
  if (
    run.status === "refused" &&
    (run.result.act === "call" || run.result.act === "run") &&
    !run.result.ok
  ) {
    const error = run.result.refused?.error;
    return {
      at: run.at,
      ok: false,
      line: error
        ? `${error.name ?? "Refused"} · error ${error.code}`
        : run.result.message,
      signature: null,
      result: run.result,
    };
  }
  return null;
};

/** The act's view with the newest reading of its account, if there is one */
const accountOn = (
  p: ConversationProgress,
  act: ActBeat
): { account?: AccountOnCard } => {
  const reading = act.account && latestReading(p, act.account.name);
  return act.account && reading
    ? { account: { view: act.account, reading } }
    : {};
};

/** A repeating card's state: its one card stands for every press */
const repeatStateOf = (
  p: ConversationProgress,
  step: Step,
  beatId: string
): ActState => {
  const run = p.runs[beatId]?.at(-1);
  if (run?.status === "started") return "running";
  if (hasRepeatEnded(p, step, beatId)) {
    return run?.status === "refused" ? "refused" : "done";
  }
  return run?.status === "interrupted" ? "interrupted" : "live";
};

const actStateOf = (run: RunRecord | undefined): ActState => {
  if (!run) return "live";
  if (run.status === "started") return "running";
  if (run.status === "ok") return "done";
  return run.status;
};

/**
 * The act to put back up as a live card: the step has not passed,
 * nothing is left to do in it, and the last act ended well, so the step's goal
 * refused the result. Null otherwise.
 */
const refusedByGoal = (
  definition: TutorialDefinition,
  p: ConversationProgress
): string | null => {
  const cursor = p.cursor;
  if (cursor.kind !== "step" || p.passed.includes(cursor.stepId)) return null;
  const step = definition.steps.find((s) => s.id === cursor.stepId);
  if (!step) return null;
  const beats = beatsOf(step, cursor.fail);
  if (cursor.beat < beats.length) return null;
  const last = [...beats].reverse().find((b) => b.kind === "act");
  if (!last) return null;
  // A repeating card stays one card, and is live until it ends
  if (last.kind === "act" && last.repeat) return null;
  return p.runs[last.id]?.at(-1)?.status === "ok" ? last.id : null;
};

/**
 * An act that ran gives way to its result card right under it: one line per
 * action, not a record and then a card that says the same (`tutorial-v2` SPEC
 * 6.5, the prototype's `Conversation`). The card's details hold the time.
 */
const isReplacedByResult = (t: Turn, next: Turn | undefined) =>
  t.kind === "act" &&
  // A repeating card's lines are its result, so it keeps its card
  !t.act.repeat &&
  (t.state === "done" || t.state === "refused" || t.state === "failed") &&
  next?.kind === "result" &&
  next.beatId === t.beatId;

export const view = (
  definition: TutorialDefinition,
  state: EngineState,
  { now, loadedAt }: ViewOptions
): ConversationView => {
  const p = state.progress;
  const all: Turn[] = [];
  const goalRefused = refusedByGoal(definition, p);
  const turn = (t: Posted) =>
    all.push({ ...t, whole: t.at < loadedAt } as Turn);

  if (p.cursor.kind === "intro") {
    turn({ id: "intro", kind: "intro", step: null, at: 0 });
  }
  // Before the lesson's turns, so a typed word's pill goes first on a tie
  // with what its action posted at the same moment
  composerTurns(definition, p).forEach(turn);

  const last = definition.steps[definition.steps.length - 1];
  definition.steps.forEach((step, index) => {
    const time = p.times[step.id];
    if (!time) return;
    const done = p.passed.includes(step.id);
    turn({
      id: `divider:${step.id}`,
      kind: "divider",
      step: step.id,
      at: time.from,
      index: index + 1,
      title: step.title,
      objective: step.objective,
      done,
      took: time.to === null ? null : time.to - time.from,
    });

    for (const fail of [false, true]) {
      const beats = beatsOf(step, fail);
      beats.forEach((b, i) => {
        const r = p.beats[b.id];
        if (!r) return;
        // Entering the planned failure through Explain echoes the press
        if (fail && i === 0) {
          turn({
            id: `you:explain:${b.id}`,
            kind: "you",
            step: step.id,
            at: r.at,
            text: EXPLAIN,
            code: false,
          });
        }
        if (b.kind === "say") {
          turn({
            id: b.id,
            kind: "say",
            step: step.id,
            at: r.at,
            beatId: b.id,
            text: b.text,
            quote: b.quote,
          });
        } else if (b.kind === "write") {
          turn({
            id: b.id,
            kind: "say",
            step: step.id,
            at: r.at,
            beatId: b.id,
            text: b.text,
          });
          if (r.kind === "written") {
            turn({
              id: `wrote:${b.id}`,
              kind: "wrote",
              step: step.id,
              at: r.at,
              beatId: b.id,
              wrote: r.wrote,
              failed: false,
            });
          } else if (r.kind === "said" && r.writeFailed) {
            turn({
              id: `wrote:${b.id}`,
              kind: "wrote",
              step: step.id,
              at: r.at,
              beatId: b.id,
              wrote: null,
              failed: true,
            });
          }
        } else if (b.kind === "ask") {
          const open = r.kind === "open";
          turn({
            id: b.id,
            kind: "ask",
            step: step.id,
            at: "openedAt" in r ? r.openedAt : r.at,
            beatId: b.id,
            ask: b,
            open,
            wrong: "wrong" in r ? r.wrong : [],
            hinted: "hintedAt" in r && r.hintedAt !== undefined,
            writeFailed: "writeFailed" in r && r.writeFailed === true,
            outcome: answerOf(r),
            attempts: attemptsOf(r),
          });
          if ("hintedAt" in r && r.hintedAt !== undefined) {
            // Asked through the assistant, the learner's own message is
            // already in the feed
            if (!r.hintByAssistant) {
              turn({
                id: `you:hint:${b.id}`,
                kind: "you",
                step: step.id,
                at: r.hintedAt,
                text: STUCK,
                code: false,
              });
            }
            turn({
              id: `hint:${b.id}`,
              kind: "hint",
              step: step.id,
              at: r.hintedAt,
              beatId: b.id,
              text: b.hint,
            });
          }
          if (r.kind === "picked") {
            turn({
              id: `you:${b.id}`,
              kind: "you",
              step: step.id,
              at: r.at,
              text: b.options[r.option],
              code: b.code,
            });
            turn({
              id: `right:${b.id}`,
              kind: "say",
              step: step.id,
              at: r.at,
              beatId: b.id,
              text: b.right,
            });
          } else if (r.kind === "typed") {
            turn({
              id: `right:${b.id}`,
              kind: "say",
              step: step.id,
              at: r.at,
              beatId: b.id,
              text: b.typed ?? b.right,
            });
          } else if (r.kind === "skipped" && r.via === "button") {
            turn({
              id: `right:${b.id}`,
              kind: "say",
              step: step.id,
              at: r.at,
              beatId: b.id,
              text: b.skipped ?? SKIPPED_DEFAULT,
            });
          }
          if (
            (r.kind === "picked" ||
              r.kind === "typed" ||
              r.kind === "skipped") &&
            r.wrote
          ) {
            turn({
              id: `wrote:${b.id}`,
              kind: "wrote",
              step: step.id,
              at: r.at,
              beatId: b.id,
              wrote: r.wrote,
              failed: false,
            });
          } else if (
            (r.kind === "picked" ||
              r.kind === "typed" ||
              r.kind === "skipped") &&
            r.writeFailed
          ) {
            turn({
              id: `wrote:${b.id}`,
              kind: "wrote",
              step: step.id,
              at: r.at,
              beatId: b.id,
              wrote: null,
              failed: true,
            });
          }
        } else {
          if (b.say) {
            turn({
              id: `say:${b.id}`,
              kind: "say",
              step: step.id,
              at: r.at,
              beatId: b.id,
              text: b.say,
            });
          }
          const runs = p.runs[b.id] ?? [];
          if (b.repeat) {
            const repeatState = repeatStateOf(p, step, b.id);
            turn({
              id: b.id,
              kind: "act",
              step: step.id,
              at: r.at,
              beatId: b.id,
              act: b,
              state: repeatState,
              presses: runs.flatMap((run) => pressOf(b, run) ?? []),
              ...accountOn(p, b),
              note: repeatState === "interrupted" ? INTERRUPTED : null,
              stage: state.stage?.beatId === b.id ? state.stage : null,
              took: null,
            });
          } else if (runs.length === 0) {
            turn({
              id: b.id,
              kind: "act",
              step: step.id,
              at: r.at,
              beatId: b.id,
              act: b,
              state: "live",
              presses: [],
              ...accountOn(p, b),
              note: null,
              stage: null,
              took: null,
            });
          }
          runs.forEach((run, n) => {
            const isLast = n === runs.length - 1;
            const cardAt = n === 0 ? r.at : run.at;
            if (!b.repeat)
              turn({
                id: n === 0 ? b.id : `${b.id}:${n}`,
                kind: "act",
                step: step.id,
                at: cardAt,
                beatId: b.id,
                act: b,
                state: actStateOf(run),
                presses: [],
                note: run.status === "interrupted" ? INTERRUPTED : null,
                stage:
                  isLast && state.stage?.beatId === b.id ? state.stage : null,
                took: ended(run) ? run.took : null,
              });
            // A repeating card's press is a line on it, unless it failed
            if (ended(run) && (!b.repeat || run.status === "failed")) {
              const planned = run.status === "failed" && run.planned === true;
              // A planned failure closes once Explain or "I'll fix it
              // myself" entered `onFail`; any other failure waits on this
              // card while it is the act's latest run
              const open =
                run.status === "failed" &&
                isLast &&
                !done &&
                run.explainedAt === undefined &&
                !(planned && p.cursor.kind === "step" && p.cursor.fail);
              turn({
                id: `result:${b.id}:${n}`,
                kind: "result",
                step: step.id,
                at: run.at + run.took,
                beatId: b.id,
                act: b.act,
                result: run.result,
                took: run.took,
                planned: planned ? step.planned ?? null : null,
                open,
                ...(b.account &&
                (run.result.act === "run" || run.result.act === "call") &&
                run.result.ok &&
                run.result.account
                  ? {
                      account: {
                        view: b.account,
                        reading: run.result.account,
                      },
                    }
                  : {}),
              });
              // An unplanned failure sent to the assistant: the press, then,
              // once its answer ended, the offer to write the fix
              if (run.status === "failed" && run.explainedAt !== undefined) {
                turn({
                  id: `you:explain:${b.id}:${n}`,
                  kind: "you",
                  step: step.id,
                  at: run.explainedAt,
                  text: EXPLAIN,
                  code: false,
                });
              }
              const offerAt =
                run.status === "failed" && run.result.act === "build"
                  ? fixOfferAt(run, loadedAt)
                  : null;
              // A call the program could not match: the same offer, at once,
              // since nothing waits on the assistant
              if (run.status === "failed" && isMismatch(run.result)) {
                turn({
                  id: `fix:${b.id}:${n}`,
                  kind: "say",
                  step: step.id,
                  at: run.at + run.took,
                  beatId: b.id,
                  text: MISMATCH_OFFER,
                  follow: {
                    kind: "showFix",
                    done: run.fixedAt !== undefined || done || !isLast,
                  },
                });
              }
              if (run.status === "failed" && offerAt !== null) {
                turn({
                  id: `fix:${b.id}:${n}`,
                  kind: "say",
                  step: step.id,
                  at: offerAt,
                  beatId: b.id,
                  text: FIX_OFFER,
                  // Only the act's latest run can be fixed: an older offer
                  // stays as a record
                  follow: {
                    kind: "showFix",
                    done: run.fixedAt !== undefined || done || !isLast,
                  },
                });
              }
              // The same slot as a failed deploy's Try again, with the act's
              // own button: see `refusedByGoal`
              const isTurnedDown = isLast && b.id === goalRefused;
              if (isTurnedDown) {
                turn({
                  id: `why:${b.id}`,
                  kind: "say",
                  step: step.id,
                  at: run.at + run.took,
                  beatId: b.id,
                  text: whyRefused(step.goal, run.result),
                });
              }
              const failedRetry = open ? retryOf(run.result) : null;
              if (isTurnedDown || failedRetry !== null) {
                turn({
                  id: `${b.id}:retry`,
                  kind: "act",
                  step: step.id,
                  at: run.at + run.took,
                  beatId: b.id,
                  // Nothing failed under a goal's refusal, so the act keeps
                  // its own label: "Try again" would say something did
                  act: isTurnedDown ? b : tryAgain(b, failedRetry),
                  state: "live",
                  presses: [],
                  note: null,
                  stage: null,
                  took: null,
                });
              }
            }
          });
        }
      });
    }

    if (done && time.to !== null) {
      const onIt = p.cursor.kind === "step" && p.cursor.stepId === step.id;
      turn({
        id: `win:${step.id}`,
        kind: "win",
        step: step.id,
        at: time.to,
        stepId: step.id,
        win: step.win,
        done: !onIt,
        took: time.to - time.from,
        via: time.via ?? "chat",
        last: step.id === last.id,
      });
    }
  });

  if (p.finishedAt !== null) {
    turn({
      id: "finish",
      kind: "finish",
      step: null,
      at: p.finishedAt,
      chips: definition.finish.chips,
      seconds: Math.round(
        (p.finishedAt - (p.startedAt ?? p.finishedAt)) / 1000
      ),
      receipt: lastLandedCall(definition, p),
    });
  }

  // Construction order is the lesson's order; time only moves a turn that
  // genuinely came later, such as a hint after its question
  const ordered = all
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.at - b.t.at || a.i - b.i)
    .map(({ t }) => t);
  const shown = ordered.filter((t) => t.at <= now);
  const turns = shown.filter((t, i) => !isReplacedByResult(t, shown[i + 1]));
  const ahead = ordered.filter((t) => t.at > now);
  const nextAt = ahead.length ? ahead[0].at : null;

  const running = turns.find((t) => t.kind === "act" && t.state === "running");
  // After the finish nothing acts; before it, the latest card that does. An
  // act of a step already passed (from the Call panel) is a record, not a card,
  // and an ended act is never live: one the goal refused returns as `:retry`
  let live: Turn | null = null;
  if (p.cursor.kind !== "finished") {
    live =
      [...turns].reverse().find((t) => {
        if (t.kind === "win") return !t.done;
        if (t.kind === "act") {
          if (t.step !== null && p.passed.includes(t.step)) return false;
          return (
            t.state === "live" ||
            t.state === "running" ||
            t.state === "interrupted"
          );
        }
        if (t.kind === "ask") return t.open;
        if (t.kind === "result") return t.open;
        return t.kind === "intro";
      }) ?? null;
  }

  const steps: StepBarItem[] = definition.steps.map((step) => {
    const time = p.times[step.id];
    const isCurrent = p.cursor.kind === "step" && p.cursor.stepId === step.id;
    let stepState: StepBarState = "not_reached";
    if (p.passed.includes(step.id)) stepState = "done";
    else if (isCurrent) stepState = "current";
    return {
      id: step.id,
      short: step.short,
      title: step.title,
      state: stepState,
      took: time?.to != null ? time.to - time.from : null,
    };
  });

  let placeholder: Placeholder = "Ask about this step";
  // Before Start there is no step to ask about yet
  if (p.cursor.kind === "intro")
    placeholder = "Ask anything about this tutorial";
  else if (p.cursor.kind === "finished") placeholder = "Ask anything";
  else if (running?.kind === "act") placeholder = WHILE[running.act.act];
  // Typing is the other way past an open question, beside its options
  else if (live?.kind === "ask" && live.open)
    placeholder = "Or ask about this step";

  const lastTime = p.times[last.id];
  const finishAt =
    p.finishedAt === null &&
    p.passed.includes(last.id) &&
    p.cursor.kind === "step" &&
    p.cursor.stepId === last.id &&
    lastTime?.to != null
      ? lastTime.to + FINISH_DELAY_MS
      : null;

  return { turns, live, steps, placeholder, nextAt, finishAt };
};

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;

  describe("features/tutorial-conversation/model/view", () => {
    let freshProgress: typeof import("./progress").freshProgress;

    describe("a repeating call act", () => {
      const repeating = (): TutorialDefinition => {
        const d = JSON.parse(JSON.stringify(hello)) as TutorialDefinition;
        d.steps[0].beats = [
          {
            kind: "act",
            id: "s1.grow",
            act: "call",
            title: "Grow",
            context: "Sends grow",
            button: "Grow",
            call: { instruction: "grow" },
            repeat: { label: "Grow to 40 KB", until: "40960" },
          },
          { kind: "say", id: "s1.after", text: "Grown." },
        ];
        return d;
      };
      const LANDED: RunRecord = {
        status: "ok",
        at: 2000,
        took: 500,
        result: {
          act: "call",
          ok: true,
          seconds: 1,
          signatures: ["5ig"],
          line: "Program log: The map is 20480 bytes",
          called: [],
        },
      };
      const STEP = "write-program";
      const stateOf = (over: {
        beat: number;
        runs: RunRecord[];
        beats?: Record<string, unknown>;
      }): EngineState => {
        const progress = freshProgress();
        progress.startedAt = 1000;
        progress.cursor = {
          kind: "step",
          stepId: STEP,
          beat: over.beat,
          fail: false,
        };
        progress.times = { [STEP]: { from: 1000, to: null } };
        progress.beats = Object.assign(
          { "s1.grow": { kind: "said", at: 1000 } },
          over.beats ?? {}
        ) as typeof progress.beats;
        progress.runs = { "s1.grow": over.runs };
        return { progress, stage: null };
      };
      const cardOf = (state: EngineState) => {
        const v = view(repeating(), state, { now: 99999, loadedAt: 0 });
        const cards = v.turns.filter((t) => t.kind === "act");
        expect(cards).toHaveLength(1);
        return { v, card: cards[0] };
      };

      it("a call the program could not match offers to show the lines", () => {
        const failed = (mismatch: boolean): RunRecord => ({
          status: "failed",
          at: 2000,
          took: 500,
          result: mismatch
            ? {
                act: "call",
                ok: false,
                seconds: 1,
                message: MISMATCH,
                log: "",
                mismatch: true,
              }
            : {
                act: "call",
                ok: false,
                seconds: 1,
                message: "Simulation failed.",
                log: "",
              },
        });
        const fixed: RunRecord = {
          status: "failed",
          at: 2000,
          took: 500,
          fixedAt: 3000,
          result: {
            act: "call",
            ok: false,
            seconds: 1,
            message: MISMATCH,
            log: "",
            mismatch: true,
          },
        };
        const offerOf = (run: RunRecord) =>
          view(repeating(), stateOf({ beat: 1, runs: [run] }), {
            now: 99999,
            loadedAt: 0,
          }).turns.find((t) => t.id === "fix:s1.grow:0");
        expect(offerOf(failed(true))).toMatchObject({
          kind: "say",
          text: MISMATCH_OFFER,
          follow: { kind: "showFix", done: false },
        });
        expect(offerOf(fixed)).toMatchObject({
          follow: { kind: "showFix", done: true },
        });
        expect(offerOf(failed(false))).toBeUndefined();
      });

      it("keeps its card over a failed press's result, which its lines are not", () => {
        const failed: RunRecord = {
          status: "failed",
          at: 2000,
          took: 500,
          result: {
            act: "call",
            ok: false,
            seconds: 1,
            message: "Blockhash expired",
            log: "",
          },
        };
        const { v, card } = cardOf(stateOf({ beat: 1, runs: [failed] }));
        expect(card.id).toBe("s1.grow");
        expect(v.turns.map((t) => t.id)).toContain("result:s1.grow:0");
      });

      it("hands the card its account's newest reading, from the save alone", () => {
        const d = repeating();
        const grow = d.steps
          .flatMap((s) => s.beats)
          .find((b) => b.id === "s1.grow");
        if (grow?.kind !== "act") throw new Error("the card moved");
        grow.account = { kind: "memory", name: "map", capacity: 40960 };
        const reading = { name: "map", address: "M", size: 20480, fields: {} };
        const run = Object.assign(JSON.parse(JSON.stringify(LANDED)), {
          result: Object.assign(JSON.parse(JSON.stringify(LANDED.result)), {
            account: reading,
          }),
        }) as RunRecord;
        const v = view(d, stateOf({ beat: 1, runs: [LANDED, run, LANDED] }), {
          now: 99999,
          loadedAt: 0,
        });
        const card = v.turns.find((t) => t.kind === "act");
        expect(card).toMatchObject({
          account: { view: grow.account, reading },
        });
      });

      it("draws on a result card the reading of its own run", () => {
        const d = repeating();
        const grow = d.steps
          .flatMap((s) => s.beats)
          .find((b) => b.id === "s1.grow");
        if (grow?.kind !== "act") throw new Error("the card moved");
        grow.repeat = undefined;
        grow.account = { kind: "memory", name: "map", capacity: 40960 };
        const reading = { name: "map", address: "M", size: 20480, fields: {} };
        const run = Object.assign(JSON.parse(JSON.stringify(LANDED)), {
          result: Object.assign(JSON.parse(JSON.stringify(LANDED.result)), {
            account: reading,
          }),
        }) as RunRecord;
        const results = view(d, stateOf({ beat: 1, runs: [LANDED, run] }), {
          now: 99999,
          loadedAt: 0,
        }).turns.filter((t) => t.kind === "result");
        expect(results).toHaveLength(2);
        expect(results[0]).not.toHaveProperty("account");
        expect(results[1]).toMatchObject({ account: { reading } });
      });

      it("draws no account before it was read", () => {
        const { card } = cardOf(stateOf({ beat: 1, runs: [LANDED] }));
        expect(card).not.toHaveProperty("account");
      });

      it("draws one live card with a line per press, and no result card", () => {
        const { v, card } = cardOf(
          stateOf({ beat: 1, runs: [LANDED, LANDED] })
        );
        expect(card).toMatchObject({ id: "s1.grow", state: "live" });
        expect(v.live?.id).toBe("s1.grow");
        const press = {
          at: 2000,
          ok: true,
          line: "The map is 20480 bytes",
          signature: "5ig",
        };
        expect(card.kind === "act" && card.presses).toMatchObject([
          press,
          press,
        ]);
        expect(v.turns.some((t) => t.kind === "result")).toBe(false);
      });

      it("is its record once the cursor went past it, and not the live card", () => {
        const { v, card } = cardOf(
          stateOf({
            beat: 2,
            runs: [LANDED],
            beats: { "s1.after": { kind: "said", at: 3000 } },
          })
        );
        expect(card).toMatchObject({ state: "done" });
        expect(v.live).toBeNull();
      });

      it("says a reload interrupted it, and keeps its lines", () => {
        const { card } = cardOf(
          stateOf({
            beat: 1,
            runs: [LANDED, { status: "interrupted", at: 3000 }],
          })
        );
        expect(card).toMatchObject({
          state: "interrupted",
          note: "Interrupted by a reload. Run it again.",
        });
        expect(card.kind === "act" && card.presses).toHaveLength(1);
      });
    });

    let hello: TutorialDefinition;
    let twoActs: TutorialDefinition;
    let reduce: typeof import("./reducer").reduce;
    let INITIAL: typeof import("./reducer").INITIAL_ENGINE_STATE;
    let TICK: number;
    beforeAll(async () => {
      hello = (await import("../../../tutorials/hello-anchor/tutorial.json"))
        .default as unknown as TutorialDefinition;
      // Hello Anchor with a second act after the first step's build
      twoActs = structuredClone(hello);
      const build = twoActs.steps[0].beats.find((b) => b.id === "s1.build");
      if (build) {
        twoActs.steps[0].beats.push(
          Object.assign(structuredClone(build), { id: "s1.second" })
        );
      }
      ({ reduce, INITIAL_ENGINE_STATE: INITIAL } = await import("./reducer"));
      ({ TICK_MS: TICK } = await import("./clock"));
      ({ freshProgress } = await import("./progress"));
    });

    type Action = import("./reducer").Action;

    const play = (actions: Action[]): EngineState => {
      const ctx = {
        definition: hello,
        slug: "hello-anchor",
        judge: (_g: unknown, r: RunResult) => r.ok,
      };
      let state = INITIAL;
      for (const a of actions) state = reduce(ctx, state, a).state;
      return state;
    };

    const OK_BUILD: RunResult = {
      act: "build",
      ok: true,
      seconds: 1.6,
      instructions: ["hello"],
    };
    const FAILED_BUILD: RunResult = {
      act: "build",
      ok: false,
      reason: "compiler",
      seconds: 1.2,
      error: {
        code: "E0412",
        file: "src/lib.rs",
        line: 9,
        column: 32,
        message: "no Hello",
      },
      log: "error[E0412]: cannot find type `Hello` in this scope",
    };
    const CALLED: RunResult = {
      act: "call",
      ok: true,
      seconds: 1,
      signatures: ["x"],
      line: null,
      called: [],
    };

    const LATE = { now: 1e9, loadedAt: 0 };
    const kinds = (v: ConversationView) => v.turns.map((t) => t.kind);
    const ids = (v: ConversationView) => v.turns.map((t) => t.id);

    it("shows the intro alone before Start, as the live card", () => {
      const v = view(hello, INITIAL, LATE);
      expect(kinds(v)).toEqual(["intro"]);
      expect(v.live?.kind).toBe("intro");
      expect(v.steps.map((s) => s.state)).toEqual([
        "not_reached",
        "not_reached",
        "not_reached",
        "not_reached",
      ]);
      expect(v.placeholder).toBe("Ask anything about this tutorial");
      expect(v.finishAt).toBeNull();
    });

    it("after Start, the divider and the first beats arrive one tick apart", () => {
      const state = play([{ type: "start", at: 1000 }]);
      const v = view(hello, state, LATE);
      expect(ids(v)).toEqual([
        "divider:write-program",
        "s1.boil",
        "s1.what",
        "s1.q1",
      ]);
      expect(v.turns.map((t) => t.at)).toEqual([
        1000,
        1000,
        1000 + TICK,
        1000 + 2 * TICK,
      ]);
      expect(v.live?.id).toBe("s1.q1");
      expect(v.steps[0].state).toBe("current");

      const early = view(hello, state, { now: 1000 + TICK, loadedAt: 0 });
      expect(ids(early)).toEqual([
        "divider:write-program",
        "s1.boil",
        "s1.what",
      ]);
      expect(early.nextAt).toBe(1000 + 2 * TICK);
      // Nothing acts while the question is still on its way
      expect(early.live).toBeNull();
    });

    it("marks turns older than the load as whole", () => {
      const state = play([{ type: "start", at: 1000 }]);
      const v = view(hello, state, { now: 1e9, loadedAt: 1000 + TICK + 1 });
      expect(v.turns.map((t) => t.whole)).toEqual([true, true, true, false]);
    });

    it("offers typing as the other way past an open question, in the placeholder", () => {
      const open = view(hello, play([{ type: "start", at: 1000 }]), LATE);
      expect(open.live).toMatchObject({ kind: "ask", open: true });
      expect(open.placeholder).toBe("Or ask about this step");
      const answered = view(
        hello,
        play([
          { type: "start", at: 1000 },
          { type: "pick", beatId: "s1.q1", option: 1, at: 5000 },
          {
            type: "written",
            beatId: "s1.q1",
            wrote: { file: "src/lib.rs", lines: [5, 6, 7] },
            at: 5000,
          },
        ]),
        LATE
      );
      expect(answered.placeholder).toBe("Ask about this step");
    });

    it("a wrong then right pick reads as a retry with its echo, the right line and the wrote card", () => {
      const state = play([
        { type: "start", at: 1000 },
        { type: "hint", beatId: "s1.q1", at: 3000 },
        { type: "pick", beatId: "s1.q1", option: 0, at: 4000 },
        { type: "pick", beatId: "s1.q1", option: 1, at: 5000 },
        {
          type: "written",
          beatId: "s1.q1",
          wrote: { file: "src/lib.rs", lines: [5, 6, 7] },
          at: 5000,
        },
      ]);
      const v = view(hello, state, LATE);
      expect(ids(v).slice(3)).toEqual([
        "s1.q1",
        "you:hint:s1.q1",
        "hint:s1.q1",
        "you:s1.q1",
        "right:s1.q1",
        "wrote:s1.q1",
        "say:s1.build",
        "s1.build",
      ]);
      const ask = v.turns.find((t) => t.id === "s1.q1");
      expect(ask).toMatchObject({
        open: false,
        wrong: [0],
        hinted: true,
        outcome: "retry",
        attempts: 2,
      });
      expect(v.turns.find((t) => t.id === "you:s1.q1")).toMatchObject({
        text: 'msg!("Hello, World!");',
        code: true,
      });
      expect(v.turns.find((t) => t.id === "you:hint:s1.q1")).toMatchObject({
        text: STUCK,
        at: 3000,
      });
      expect(v.live).toMatchObject({
        id: "s1.build",
        kind: "act",
        state: "live",
      });
    });

    it("the composer's records post as pills, the lesson's replies and apply cards, in their step", () => {
      const v = view(
        hello,
        play([
          { type: "start", at: 1000 },
          { type: "refuseWord", word: "build", text: "build", at: 3000 },
          {
            type: "propose",
            proposal: {
              id: "p1",
              file: "programs/hello/src/lib.rs",
              line: 10,
              before: "old",
              after: "new",
            },
            at: 4000,
          },
          { type: "applied", id: "p1", at: 6000 },
        ]),
        LATE
      );
      const byId = (id: string) => v.turns.find((t) => t.id === id);
      expect(byId("said:0")).toMatchObject({
        kind: "you",
        text: "build",
        step: "write-program",
      });
      expect(byId("reply:0")).toMatchObject({
        kind: "reply",
        text: PICK_FIRST,
      });
      expect(byId("apply:p1")).toMatchObject({
        kind: "apply",
        at: 4000,
        proposal: { state: "applied", settledAt: 6000 },
      });
      // The wrote card sits where Apply landed, not where the card was posted
      expect(byId("wrote:p1")).toMatchObject({
        kind: "wrote",
        at: 6000,
        wrote: { file: "programs/hello/src/lib.rs", lines: [10] },
      });
    });

    it("a finish chip posts its label and the definition's answer, with its quiet button", () => {
      const done: EngineState = {
        progress: {
          version: 1,
          passed: hello.steps.map((s) => s.id),
          finishedAt: 60000,
          startedAt: 1000,
          restartedAt: null,
          cursor: { kind: "finished" },
          beats: {},
          runs: {},
          times: {},
          said: [{ kind: "chip", index: 0, at: 61000 }],
          proposals: [],
          accounts: {},
        },
        stage: null,
      };
      const v = view(hello, done, LATE);
      const chip = hello.finish.chips[0];
      expect(v.turns.slice(-2)).toMatchObject([
        { id: "said:0", kind: "you", text: chip.label, step: null },
        {
          id: "reply:0",
          kind: "reply",
          text: chip.answer,
          follow: chip.follow ?? null,
        },
      ]);
    });

    it("a hint the assistant asked for posts with no I'm stuck pill", () => {
      const v = view(
        hello,
        play([
          { type: "start", at: 1000 },
          { type: "hint", beatId: "s1.q1", at: 3000, byAssistant: true },
        ]),
        LATE
      );
      expect(v.turns.find((t) => t.id === "hint:s1.q1")).toBeTruthy();
      expect(v.turns.find((t) => t.id === "you:hint:s1.q1")).toBeUndefined();
    });

    it("skip and typed read as their outcomes", () => {
      const skipped = view(
        hello,
        play([
          { type: "start", at: 1000 },
          { type: "skip", beatId: "s1.q1", at: 4000 },
        ]),
        LATE
      );
      expect(skipped.turns.find((t) => t.id === "s1.q1")).toMatchObject({
        outcome: "skipped",
      });
      expect(skipped.turns.find((t) => t.id === "right:s1.q1")).toMatchObject({
        text: SKIPPED_DEFAULT,
      });
      const typed = view(
        hello,
        play([
          { type: "start", at: 1000 },
          {
            type: "edit",
            file: "src/lib.rs",
            content: 'msg!("Hello, World!");',
            at: 4000,
          },
        ]),
        LATE
      );
      expect(typed.turns.find((t) => t.id === "s1.q1")).toMatchObject({
        outcome: "typed",
      });
    });

    const toFailed = (): Action[] => [
      { type: "start", at: 1000 },
      { type: "pick", beatId: "s1.q1", option: 1, at: 5000 },
      { type: "act", beatId: "s1.build", at: 7000 },
      { type: "ended", beatId: "s1.build", result: FAILED_BUILD, at: 8200 },
    ];

    const toDeploy = (): Action[] => [
      { type: "start", at: 1000 },
      { type: "pick", beatId: "s1.q1", option: 1, at: 5000 },
      { type: "act", beatId: "s1.build", at: 7000 },
      { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
      { type: "next", at: 9000 },
      { type: "skip", beatId: "s2.q2", at: 9500 },
      { type: "act", beatId: "s2.deploy", at: 10000 },
    ];
    const NO_FUNDS: RunResult = {
      act: "deploy",
      ok: false,
      seconds: 2,
      reason: "no_funds",
      message: "airdrop refused",
      balance: 0,
      cost: 1_270_000_000,
      address: "WaLLet",
    };
    const deployEnded = (result: RunResult): Action => ({
      type: "ended",
      beatId: "s2.deploy",
      result,
      at: 12000,
    });

    it("a deploy the faucet stopped posts its open result, then a live Try again that asks the faucet again", () => {
      const v = view(
        hello,
        play(toDeploy().concat([deployEnded(NO_FUNDS)])),
        LATE
      );
      // The act before the failure is not drawn: its result is right under it
      expect(ids(v).slice(-2)).toEqual([
        "result:s2.deploy:0",
        "s2.deploy:retry",
      ]);
      expect(v.turns.find((t) => t.id === "result:s2.deploy:0")).toMatchObject({
        open: true,
      });
      expect(v.live).toMatchObject({
        id: "s2.deploy:retry",
        kind: "act",
        beatId: "s2.deploy",
        state: "live",
        act: {
          button: "Try again",
          context: "Asks the faucet again, then deploys",
        },
      });
    });

    it("a deploy that failed gives way to its result and offers Try again with the act's own line", () => {
      const failed: RunResult = {
        act: "deploy",
        ok: false,
        seconds: 4,
        reason: "failed",
        message: "Blockhash expired",
      };
      const v = view(
        hello,
        play(toDeploy().concat([deployEnded(failed)])),
        LATE
      );
      expect(ids(v)).not.toContain("s2.deploy");
      expect(ids(v).slice(-2)).toEqual([
        "result:s2.deploy:0",
        "s2.deploy:retry",
      ]);
      expect(v.live).toMatchObject({
        id: "s2.deploy:retry",
        act: {
          button: "Try again",
          context: "From your Playground wallet · free devnet SOL",
        },
      });
    });

    it("no wallet offers no Try again: the result's Create wallet runs it", () => {
      const v = view(
        hello,
        play(
          toDeploy().concat([
            deployEnded({
              act: "deploy",
              ok: false,
              seconds: 0,
              reason: "no_wallet",
              message: "No wallet",
            }),
          ])
        ),
        LATE
      );
      expect(ids(v)).not.toContain("s2.deploy:retry");
      expect(v.live).toMatchObject({ id: "result:s2.deploy:0", open: true });
    });

    it("pressing Try again is a second run, and the retry card gives way to it", () => {
      const v = view(
        hello,
        play(
          toDeploy().concat([
            deployEnded(NO_FUNDS),
            { type: "act", beatId: "s2.deploy", at: 20000 },
          ])
        ),
        LATE
      );
      expect(ids(v)).not.toContain("s2.deploy:retry");
      expect(v.live).toMatchObject({ id: "s2.deploy:1", state: "running" });
    });

    it("a second refusal after Try again posts one more faucet card and one Try again", () => {
      const v = view(
        hello,
        play(
          toDeploy().concat([
            deployEnded(NO_FUNDS),
            { type: "act", beatId: "s2.deploy", at: 20000 },
            {
              type: "ended",
              beatId: "s2.deploy",
              result: NO_FUNDS,
              at: 21000,
            },
          ])
        ),
        LATE
      );
      expect(ids(v).slice(-3)).toEqual([
        "result:s2.deploy:0",
        "result:s2.deploy:1",
        "s2.deploy:retry",
      ]);
      expect(ids(v).filter((id) => id === "s2.deploy:retry")).toHaveLength(1);
      expect(v.turns.find((t) => t.id === "result:s2.deploy:0")).toMatchObject({
        open: false,
      });
      expect(v.live).toMatchObject({ id: "s2.deploy:retry" });
    });

    it("a deploy a reload cut short is the live act again, with no Try again", () => {
      const state = play(toDeploy());
      state.progress.runs["s2.deploy"] = [{ status: "interrupted", at: 10000 }];
      const v = view(hello, state, LATE);
      expect(ids(v)).not.toContain("s2.deploy:retry");
      expect(v.live).toMatchObject({
        id: "s2.deploy",
        state: "interrupted",
        note: INTERRUPTED,
      });
    });

    it("a build-and-deploy that failed gets Try again with its own line", () => {
      const result: RunResult = {
        act: "buildDeploy",
        ok: false,
        seconds: 4,
        reason: "failed",
        message: "Blockhash expired",
      };
      expect(retryOf(result)).toBe("again");
      expect(retryOf(NO_FUNDS)).toBe("faucet");
      expect(retryOf(OK_BUILD)).toBeNull();
    });

    it("a running act shows its stage and changes the placeholder", () => {
      const state = play(
        toFailed()
          .slice(0, 3)
          .concat([
            {
              type: "stage",
              beatId: "s1.build",
              label: "Building",
              index: 1,
              count: 1,
              at: 7100,
            },
          ])
      );
      const v = view(hello, state, LATE);
      expect(v.live).toMatchObject({
        id: "s1.build",
        state: "running",
        stage: { label: "Building", index: 1, count: 1 },
      });
      expect(v.placeholder).toBe("Ask while it builds");
    });

    it("says it runs while a run or a call goes, and builds for the rest", () => {
      expect(WHILE.run).toBe("Ask while it runs");
      expect(WHILE.call).toBe("Ask while it runs");
      expect([WHILE.build, WHILE.deploy, WHILE.buildDeploy]).toEqual([
        "Ask while it builds",
        "Ask while it builds",
        "Ask while it builds",
      ]);
    });

    it("a planned failure posts an open result with the definition's line, then Explain's pill and the fix question", () => {
      const failed = view(hello, play(toFailed()), LATE);
      expect(ids(failed)).not.toContain("s1.build");
      const result = failed.turns.find((t) => t.kind === "result");
      expect(result).toMatchObject({
        id: "result:s1.build:0",
        at: 8200,
        planned: hello.steps[0].planned,
        open: true,
      });
      expect(failed.live?.id).toBe("result:s1.build:0");

      const explained = view(
        hello,
        play(
          toFailed().concat([{ type: "explain", beatId: "s1.build", at: 9000 }])
        ),
        LATE
      );
      expect(ids(explained).slice(-3)).toEqual([
        "you:explain:f1.explain",
        "f1.explain",
        "f1.q2",
      ]);
      expect(
        explained.turns.find((t) => t.id === "you:explain:f1.explain")
      ).toMatchObject({ text: EXPLAIN });
      expect(explained.turns.find((t) => t.kind === "result")).toMatchObject({
        open: false,
      });
      expect(explained.live?.id).toBe("f1.q2");
    });

    it("a typed explain echoes once, as Explain the error", () => {
      const typed = view(
        hello,
        play(
          toFailed().concat([
            {
              type: "word",
              word: "explain",
              text: "explain",
              then: { type: "explain", beatId: "s1.build", at: 9000 },
              at: 9000,
            },
          ])
        ),
        LATE
      );
      expect(typed.turns.filter((t) => t.kind === "you")).toHaveLength(
        view(
          hello,
          play(
            toFailed().concat([
              { type: "explain", beatId: "s1.build", at: 9000 },
            ])
          ),
          LATE
        ).turns.filter((t) => t.kind === "you").length
      );
      expect(ids(typed).slice(-3)).toEqual([
        "you:explain:f1.explain",
        "f1.explain",
        "f1.q2",
      ]);
    });

    it("a failed fix build is an ordinary failure with a live result card", () => {
      const state = play(
        toFailed().concat([
          { type: "explain", beatId: "s1.build", at: 9000 },
          { type: "pick", beatId: "f1.q2", option: 2, at: 9500 },
          { type: "act", beatId: "f1.build", at: 10000 },
          {
            type: "ended",
            beatId: "f1.build",
            result: FAILED_BUILD,
            at: 11000,
          },
        ])
      );
      const v = view(hello, state, LATE);
      const result = v.turns.find((t) => t.id === "result:f1.build:0");
      expect(result).toMatchObject({ planned: null, open: true });
      expect(v.live?.id).toBe("result:f1.build:0");
      // The first, planned, failure stays closed
      expect(v.turns.find((t) => t.id === "result:s1.build:0")).toMatchObject({
        planned: hello.steps[0].planned,
        open: false,
      });
    });

    it("an unplanned failure explained by the assistant offers Show me the fix, once", () => {
      const before = toFailed().concat([
        { type: "explain", beatId: "s1.build", at: 9000 },
        { type: "pick", beatId: "f1.q2", option: 2, at: 9500 },
        { type: "act", beatId: "f1.build", at: 10000 },
        { type: "ended", beatId: "f1.build", result: FAILED_BUILD, at: 11000 },
        { type: "explain", beatId: "f1.build", at: 12000 },
      ]);
      const asked = view(hello, play(before), LATE);
      expect(
        asked.turns.find((t) => t.id === "result:f1.build:0")
      ).toMatchObject({
        open: false,
      });
      expect(ids(asked).slice(-1)).toEqual(["you:explain:f1.build:0"]);
      expect(
        asked.turns.find((t) => t.id === "fix:f1.build:0")
      ).toBeUndefined();

      const answered = before.concat([
        { type: "answered", beatId: "f1.build", at: 13000 },
      ]);
      const offered = view(hello, play(answered), LATE);
      expect(ids(offered).slice(-2)).toEqual([
        "you:explain:f1.build:0",
        "fix:f1.build:0",
      ]);
      expect(offered.turns.at(-1)).toMatchObject({
        kind: "say",
        text: FIX_OFFER,
        follow: { kind: "showFix", done: false },
      });

      const used = view(
        hello,
        play(
          answered.concat([{ type: "showFix", beatId: "f1.build", at: 14000 }])
        ),
        LATE
      );
      expect(used.turns.find((t) => t.id === "fix:f1.build:0")).toMatchObject({
        follow: { kind: "showFix", done: true },
      });
    });

    it("offers the fix after a reload that came while the assistant answered", () => {
      const asked = play(
        toFailed().concat([
          { type: "explain", beatId: "s1.build", at: 9000 },
          { type: "pick", beatId: "f1.q2", option: 2, at: 9500 },
          { type: "act", beatId: "f1.build", at: 10000 },
          {
            type: "ended",
            beatId: "f1.build",
            result: FAILED_BUILD,
            at: 11000,
          },
          { type: "explain", beatId: "f1.build", at: 12000 },
        ])
      );
      const reloaded = view(hello, asked, { now: 1e9, loadedAt: 20000 });
      expect(reloaded.turns.at(-1)).toMatchObject({
        id: "fix:f1.build:0",
        at: 20000,
        follow: { kind: "showFix", done: false },
      });
      // Before any reload the offer waits for the answer
      const live = view(hello, asked, { now: 1e9, loadedAt: 0 });
      expect(live.turns.find((t) => t.id === "fix:f1.build:0")).toBeUndefined();
    });

    it("leaves an older run's fix offer as a record", () => {
      const twice = play(
        toFailed().concat([
          { type: "explain", beatId: "s1.build", at: 9000 },
          { type: "pick", beatId: "f1.q2", option: 2, at: 9500 },
          { type: "act", beatId: "f1.build", at: 10000 },
          {
            type: "ended",
            beatId: "f1.build",
            result: FAILED_BUILD,
            at: 11000,
          },
          { type: "explain", beatId: "f1.build", at: 12000 },
          { type: "answered", beatId: "f1.build", at: 13000 },
          { type: "act", beatId: "f1.build", at: 14000 },
          {
            type: "ended",
            beatId: "f1.build",
            result: FAILED_BUILD,
            at: 15000,
          },
        ])
      );
      const v = view(hello, twice, LATE);
      expect(v.turns.find((t) => t.id === "fix:f1.build:0")).toMatchObject({
        follow: { kind: "showFix", done: true },
      });
      expect(v.live?.id).toBe("result:f1.build:1");
    });

    it("a write that could not land shows as a failed wrote card", () => {
      const state = play([
        { type: "start", at: 1000 },
        { type: "writeFailed", beatId: "s1.boil", at: 1000 },
        { type: "pick", beatId: "s1.q1", option: 1, at: 5000 },
        { type: "writeFailed", beatId: "s1.q1", at: 5000 },
      ]);
      const v = view(hello, state, LATE);
      expect(v.turns.find((t) => t.id === "wrote:s1.boil")).toMatchObject({
        kind: "wrote",
        wrote: null,
        failed: true,
      });
      expect(v.turns.find((t) => t.id === "s1.q1")).toMatchObject({
        writeFailed: true,
      });
      expect(v.turns.find((t) => t.id === "wrote:s1.q1")).toMatchObject({
        failed: true,
      });
    });

    it("a question skipped from elsewhere posts no Skip line and no wrote card", () => {
      const v = view(
        hello,
        play([
          { type: "start", at: 1000 },
          { type: "passed", via: "client", result: OK_BUILD, at: 4000 },
        ]),
        LATE
      );
      expect(v.turns.find((t) => t.id === "s1.q1")).toMatchObject({
        outcome: "skipped",
        open: false,
      });
      expect(v.turns.find((t) => t.id === "right:s1.q1")).toBeUndefined();
      expect(v.turns.find((t) => t.id === "wrote:s1.q1")).toBeUndefined();
      expect(v.turns.find((t) => t.id === "win:write-program")).toMatchObject({
        via: "client",
      });
    });

    it("nothing is live after the finish, even an act the step left unpressed", () => {
      const steps: Action[] = toFailed()
        .slice(0, 3)
        .concat([
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
          { type: "next", at: 9000 },
          { type: "passed", via: "call_panel", result: CALLED, at: 9500 },
          { type: "next", at: 10000 },
          { type: "passed", via: "call_panel", result: CALLED, at: 10500 },
          { type: "next", at: 11000 },
          { type: "pick", beatId: "s4.q4", option: 1, at: 11500 },
          // The panel passes the step while s4.ship is still unpressed
          { type: "passed", via: "call_panel", result: CALLED, at: 14000 },
        ]);
      const won = view(hello, play(steps), LATE);
      expect(won.live).toMatchObject({ id: "win:greet-by-name" });
      expect(won.turns.find((t) => t.id === "s4.ship")).toMatchObject({
        state: "live",
      });
      const done = view(
        hello,
        play(steps.concat([{ type: "finish", at: 14400 }])),
        LATE
      );
      expect(done.live).toBeNull();
    });

    it("an act whose ok result the goal refused comes back live, with its own button", () => {
      const refusing = {
        definition: hello,
        slug: "hello-anchor",
        judge: () => false,
      };
      let state = INITIAL;
      for (const a of toFailed().slice(0, 3))
        state = reduce(refusing, state, a).state;
      state = reduce(refusing, state, {
        type: "ended",
        beatId: "s1.build",
        result: OK_BUILD,
        at: 8600,
      }).state;
      const v = view(hello, state, LATE);
      expect(ids(v)).not.toContain("s1.build");
      expect(ids(v).slice(-3)).toEqual([
        "result:s1.build:0",
        "why:s1.build",
        "s1.build:retry",
      ]);
      expect(v.live).toMatchObject({
        id: "s1.build:retry",
        kind: "act",
        state: "live",
        beatId: "s1.build",
        act: { id: "s1.build", button: "Build" },
      });
      state = reduce(refusing, state, {
        type: "act",
        beatId: "s1.build",
        at: 9000,
      }).state;
      state = reduce(refusing, state, {
        type: "ended",
        beatId: "s1.build",
        result: OK_BUILD,
        at: 10600,
      }).state;
      const again = view(hello, state, LATE);
      // One line, the latest refusal's, under the latest result
      expect(ids(again).slice(-4)).toEqual([
        "result:s1.build:0",
        "result:s1.build:1",
        "why:s1.build",
        "s1.build:retry",
      ]);
      expect(again.live?.id).toBe("s1.build:retry");
    });

    it("a run the goal refused keeps its record until its result is due", () => {
      const state = play(toFailed());
      const run = state.progress.runs["s1.build"][0];
      const due = view(hello, state, {
        now: run.at + 1,
        loadedAt: LATE.loadedAt,
      });
      expect(ids(due)).toContain("s1.build");
      expect(ids(due)).not.toContain("result:s1.build:0");
    });

    it("the line and the card go once a run passes the step", () => {
      const judge = (_goal: unknown, result: RunResult) =>
        result.act === "build" && result.ok && result.seconds === 2;
      const ctx = { definition: hello, slug: "hello-anchor", judge };
      let state = INITIAL;
      for (const a of toFailed().slice(0, 3))
        state = reduce(ctx, state, a).state;
      state = reduce(ctx, state, {
        type: "ended",
        beatId: "s1.build",
        result: { act: "build", ok: true, seconds: 1, instructions: [] },
        at: 8600,
      }).state;
      expect(ids(view(hello, state, LATE))).toContain("why:s1.build");
      state = reduce(ctx, state, {
        type: "act",
        beatId: "s1.build",
        at: 9000,
      }).state;
      state = reduce(ctx, state, {
        type: "ended",
        beatId: "s1.build",
        result: { act: "build", ok: true, seconds: 2, instructions: ["hello"] },
        at: 10600,
      }).state;
      const passed = view(hello, state, LATE);
      expect(ids(passed)).not.toContain("why:s1.build");
      expect(ids(passed)).not.toContain("s1.build:retry");
      expect(passed.live?.kind).toBe("win");
    });

    it("says why the goal turned a run down, from the goal, never its log pattern", () => {
      const goalOf = (i: number) => hello.steps[i].goal;
      type Called = import("./progress").Called;
      const ran = (line: string | null, called: Called[]): RunResult => ({
        act: "run",
        ok: true,
        seconds: 1,
        signatures: ["sig"],
        line,
        called,
      });
      expect(
        whyRefused(goalOf(0), {
          act: "build",
          ok: true,
          seconds: 1,
          instructions: [],
        })
      ).toBe(
        "It built, but the program has no `hello` instruction. This step needs one."
      );
      expect(whyRefused(goalOf(2), ran(null, []))).toBe(
        "It ran, but it didn't call `hello`. This step needs that call."
      );
      expect(whyRefused(goalOf(3), ran(null, []))).toBe(
        "It ran, but it didn't call `hello`. This step needs that call."
      );
      expect(
        whyRefused(
          goalOf(2),
          ran("Hello, Mars!", [{ instruction: "hello", args: {} }])
        )
      ).toBe("It called `hello`, but the log isn't the one this step expects.");
      expect(
        whyRefused(goalOf(3), ran("Hi", [{ instruction: "hello", args: {} }]))
      ).toBe("It ran, but this step isn't done yet.");
      expect(
        whyRefused(goalOf(2), {
          act: "run",
          ok: true,
          seconds: 1,
          signatures: ["sig"],
          line: null,
          called: [],
          undecoded: true,
        })
      ).toBe(MISMATCH);
    });

    it("an ok result offers no Try again while the step still has an act to press", () => {
      const refusing = {
        definition: twoActs,
        slug: "hello-anchor",
        judge: () => false,
      };
      let state = INITIAL;
      for (const a of toFailed().slice(0, 3))
        state = reduce(refusing, state, a).state;
      state = reduce(refusing, state, {
        type: "ended",
        beatId: "s1.build",
        result: OK_BUILD,
        at: 8600,
      }).state;
      const v = view(twoActs, state, LATE);
      expect(ids(v)).not.toContain("s1.build:retry");
      expect(ids(v)).not.toContain("why:s1.build");
      expect(v.live?.id).toBe("s1.second");
    });

    it("an ended act stays drawn when a turn stands between it and its result", () => {
      const state = play(toFailed());
      const run = state.progress.runs["s1.build"][0];
      const asked = structuredClone(state);
      asked.progress.said = [{ kind: "word", text: "why", at: run.at + 1 }];
      const v = view(hello, asked, LATE);
      expect(ids(v)).toContain("s1.build");
    });

    it("a run again keeps the first result as a record and posts a second card", () => {
      const state = play(
        toFailed().concat([
          { type: "act", beatId: "s1.build", at: 9000 },
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 10600 },
        ])
      );
      const v = view(hello, state, LATE);
      expect(ids(v).slice(-3)).toEqual([
        "result:s1.build:0",
        "result:s1.build:1",
        "win:write-program",
      ]);
      expect(v.turns.find((t) => t.id === "result:s1.build:0")).toMatchObject({
        open: false,
      });
      expect(v.live).toMatchObject({
        id: "win:write-program",
        done: false,
        took: 9600,
        last: false,
      });
      expect(v.steps[0]).toMatchObject({ state: "done", took: 9600 });
    });

    it("a refused run gives way to its closed result card, and the win follows", () => {
      // The view reads a run's record, not the goal behind it, so Hello
      // Anchor's build card stands in for a refused call card here
      const state = play(toFailed().slice(0, 3));
      const result: RunResult = {
        act: "call",
        ok: false,
        seconds: 0.9,
        message: "Not enough energy",
        log: "Program log: AnchorError ... Error Number: 6000.",
        refused: {
          instruction: "chop_tree",
          error: { code: 6000, name: "NotEnoughEnergy" },
        },
      };
      const refused: EngineState = {
        progress: {
          version: 1,
          passed: ["write-program"],
          finishedAt: null,
          startedAt: state.progress.startedAt,
          restartedAt: null,
          said: [],
          proposals: [],
          accounts: {},
          cursor: state.progress.cursor,
          beats: state.progress.beats,
          runs: {
            "s1.build": [{ status: "refused", at: 7000, took: 900, result }],
          },
          times: {
            "write-program": { from: 1000, to: 7900, via: "chat" },
          },
        },
        stage: null,
      };
      const v = view(hello, refused, LATE);
      expect(ids(v)).not.toContain("s1.build");
      expect(v.turns.find((t) => t.id === "result:s1.build:0")).toMatchObject({
        result,
        took: 900,
        planned: null,
        open: false,
      });
      expect(v.live).toMatchObject({ id: "win:write-program", done: false });
    });

    it("an interrupted run is the live act again", () => {
      const state = play(toFailed().slice(0, 3));
      const interrupted: EngineState = {
        progress: {
          version: 1,
          passed: state.progress.passed,
          finishedAt: null,
          startedAt: state.progress.startedAt,
          restartedAt: null,
          said: [],
          proposals: [],
          accounts: {},
          cursor: state.progress.cursor,
          beats: state.progress.beats,
          runs: { "s1.build": [{ status: "interrupted", at: 7000 }] },
          times: state.progress.times,
        },
        stage: null,
      };
      const v = view(hello, interrupted, LATE);
      expect(v.live).toMatchObject({
        id: "s1.build",
        state: "interrupted",
        note: INTERRUPTED,
      });
    });

    it("the finish reads its receipt from the last step's landed call", () => {
      const ran = (at: number, signature: string): RunRecord => ({
        status: "ok",
        at,
        took: 900,
        result: {
          act: "call",
          ok: true,
          seconds: 0.9,
          signatures: [signature],
          line: "Program log: Hello, Alex!",
          called: [],
        },
      });
      const done: EngineState = {
        progress: {
          version: 1,
          passed: hello.steps.map((s) => s.id),
          finishedAt: 60000,
          startedAt: 1000,
          restartedAt: null,
          said: [],
          proposals: [],
          accounts: {},
          cursor: { kind: "finished" },
          beats: {},
          runs: {
            "s3.run": [ran(30000, "first")],
            // A later call the program refused is no receipt
            "s4.call": [
              ran(50000, "last"),
              {
                status: "failed",
                at: 55000,
                took: 900,
                result: {
                  act: "call",
                  ok: false,
                  seconds: 0.9,
                  message: "refused",
                  log: "",
                },
              },
            ],
          },
          times: {},
        },
        stage: null,
      };
      const finish = view(hello, done, LATE).turns.at(-1);
      expect(finish).toMatchObject({
        kind: "finish",
        seconds: 59,
        receipt: { signatures: ["last"] },
      });

      // The last step passed with no run of its own: an earlier step's
      // transaction is not its receipt
      const earlierOnly: EngineState = {
        progress: {
          version: 1,
          passed: hello.steps.map((s) => s.id),
          finishedAt: 60000,
          startedAt: 1000,
          restartedAt: null,
          said: [],
          proposals: [],
          accounts: {},
          cursor: { kind: "finished" },
          beats: {},
          runs: { "s3.run": [ran(30000, "first")] },
          times: {},
        },
        stage: null,
      };
      expect(view(hello, earlierOnly, LATE).turns.at(-1)).toMatchObject({
        kind: "finish",
        receipt: null,
      });
    });

    it("the finish's receipt is the call that landed last, by time, and on a tie the later record", () => {
      const ran = (at: number, signature: string): RunRecord => ({
        status: "ok",
        at,
        took: 900,
        result: {
          act: "call",
          ok: true,
          seconds: 0.9,
          signatures: [signature],
          line: null,
          called: [],
        },
      });
      const finished = (runs: RunRecord[]): EngineState => ({
        progress: {
          version: 1,
          passed: hello.steps.map((s) => s.id),
          finishedAt: 60000,
          startedAt: 1000,
          restartedAt: null,
          cursor: { kind: "finished" },
          beats: {},
          runs: { "s4.call": runs },
          times: {},
          said: [],
          proposals: [],
          accounts: {},
        },
        stage: null,
      });
      const receiptOf = (runs: RunRecord[]) => {
        const finish = view(hello, finished(runs), LATE).turns.at(-1);
        return finish?.kind === "finish" ? finish.receipt?.signatures : null;
      };
      // Records keep their order, oldest first; a later time wins wherever
      // the record sits
      expect(receiptOf([ran(50000, "later"), ran(40000, "earlier")])).toEqual([
        "later",
      ]);
      expect(receiptOf([ran(40000, "earlier"), ran(50000, "later")])).toEqual([
        "later",
      ]);
      // Two calls in the same millisecond: the one recorded after is the last
      expect(receiptOf([ran(50000, "first"), ran(50000, "second")])).toEqual([
        "second",
      ]);
    });

    it("next makes the win a record; the last win is live with no next and schedules the finish", () => {
      const steps: Action[] = toFailed()
        .slice(0, 3)
        .concat([
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
          { type: "next", at: 9000 },
          { type: "passed", via: "call_panel", result: CALLED, at: 9500 },
          { type: "next", at: 10000 },
          { type: "passed", via: "call_panel", result: CALLED, at: 10500 },
          { type: "next", at: 11000 },
          { type: "passed", via: "call_panel", result: CALLED, at: 11500 },
        ]);
      const v = view(hello, play(steps), LATE);
      expect(v.turns.find((t) => t.id === "win:write-program")).toMatchObject({
        done: true,
      });
      expect(v.turns.find((t) => t.id === "s2.q2")).toMatchObject({
        outcome: "call_panel",
      });
      expect(v.turns.find((t) => t.id === "win:call-client")).toMatchObject({
        via: "call_panel",
      });
      expect(v.live).toMatchObject({
        id: "win:greet-by-name",
        done: false,
        last: true,
      });
      expect(v.finishAt).toBe(11500 + FINISH_DELAY_MS);
      expect(v.steps.map((s) => s.state)).toEqual([
        "done",
        "done",
        "done",
        "done",
      ]);

      const finished = view(
        hello,
        play(steps.concat([{ type: "finish", at: 11900 }])),
        LATE
      );
      expect(finished.turns.at(-1)).toMatchObject({
        kind: "finish",
        at: 11900,
        chips: hello.finish.chips,
        // From Start at 1000 to the finish
        seconds: 11,
        // Every pass here came from the Call panel, which leaves no run
        receipt: null,
      });
      expect(
        finished.turns.find((t) => t.id === "win:greet-by-name")
      ).toMatchObject({ done: true });
      expect(finished.live).toBeNull();
      expect(finished.placeholder).toBe("Ask anything");
      expect(finished.finishAt).toBeNull();
    });
  });
}
