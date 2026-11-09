/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { Idl } from "@coral-xyz/anchor";

import type {
  Act,
  ActBeat,
  Ask,
  Beat,
  Block,
  CallArg,
  Goal,
  QuestionResult,
  Step,
  TutorialDefinition,
  TutorialEvents,
} from "@/entities/tutorial";
import { sameIdlName } from "@/shared/lib/idl-name";

import { isPlannedLog } from "./build-error";
import { TICK_MS } from "./clock";
import { nextDeployed } from "./deployed-idl";
import { holds, keyOf, typedKey } from "./landing";
import type { Judge, RunInput } from "./ports";
import { PROGRAM_FILE } from "./program-source";
import type {
  ApplyFailure,
  ConversationProgress,
  Cursor,
  PassedVia,
  PassReason,
  Proposal,
  Resolution,
  RunRecord,
  RunResult,
  SkipVia,
  UnreadTx,
  Wrote,
} from "./progress";
import {
  answerOf,
  existsOf,
  freshProgress,
  hintOf,
  isMismatch,
  isSignedOut,
  isUnconfirmed,
  isUnreachable,
} from "./progress";
import type { Word } from "./route";
import { shippedIdl, shippedIdlAt } from "./shipped-idl";

/**
 * The conversation engine's reducer: the lesson's rules over a definition
 * and the learner's saved progress, with no clock, no file and no React.
 * Every action carries `at`. The reducer returns the next state and the
 * effects the store must carry out (a write, a run, an event); it never
 * carries them out itself, so the whole lesson runs in a unit test.
 *
 * The shape follows the prototype's `store.tsx` (`flow`, the write queue,
 * the planned-failure rule); where it differs, `plans/3.1-conversation-engine.md`
 * says why.
 */
// TODO(HOO-2362): model the lesson as an explicit state machine (states, events, allowed transitions) in its own OpenSpec change; the rules are spread across this reducer's cases

export interface EngineContext {
  definition: TutorialDefinition;
  /** The tutorial's slug, for its events */
  slug: string;
  judge: Judge;
}

export interface EngineState {
  /** What is saved */
  progress: ConversationProgress;
  /** The running act's stage, in memory only: a reload interrupts the run */
  stage: Stage | null;
}

export interface Stage {
  beatId: string;
  label: string;
  /** 1-based, of `count` */
  index: number;
  count: number;
  /** How far a long stage has got, as the runner's `RunStage` reports it */
  detail?: string;
}

export const INITIAL_ENGINE_STATE: EngineState = {
  progress: freshProgress(),
  stage: null,
};

export type Action =
  | { type: "start"; at: number }
  | { type: "pick"; beatId: string; option: number; at: number }
  | {
      type: "hint";
      beatId: string;
      at: number;
      /** The live assistant's Hint tool, not the card: no pill */
      byAssistant?: true;
    }
  /** The question's Skip button; a skip from elsewhere is `pass`'s to record */
  | { type: "skip"; beatId: string; at: number }
  | { type: "typeIt"; beatId: string; at: number }
  /** The learner changed a file; `content` is the whole file now */
  | { type: "edit"; file: string; content: string; at: number }
  /** A queued write landed */
  | { type: "written"; beatId: string; wrote: Wrote; at: number }
  /** A queued write could not land; the card says so */
  | { type: "writeFailed"; beatId: string; at: number }
  /** An act card pressed, or its composer word */
  | {
      type: "act";
      beatId: string;
      /** A call act's argument values, by name */
      args?: Record<string, string>;
      /**
       * "Check again" on an unconfirmed result: read what the last run sent,
       * send nothing. Taken only while the beat's last run is unconfirmed.
       */
      recheck?: true;
      at: number;
    }
  | {
      type: "stage";
      beatId: string;
      /** The run this stage belongs to, by its start; a stale run's is dropped */
      startedAt?: number;
      label: string;
      index: number;
      count: number;
      detail?: string;
      at: number;
    }
  | {
      type: "ended";
      beatId: string;
      /** The run this result belongs to, by its start; a stale run's is dropped */
      startedAt?: number;
      result: RunResult;
      at: number;
    }
  /**
   * A load found these acts' runs in flight in the save: a reload
   * interrupted them (`parseProgress`). Only measured; the cards read the
   * interrupted records themselves
   */
  | { type: "interrupted"; beatIds: string[]; at: number }
  /**
   * A run a reload interrupted, found landed on the chain after the load:
   * its result posts as if the run had ended, rather than the interrupted card
   */
  | { type: "recognised"; beatId: string; result: RunResult; at: number }
  /**
   * The program deployed outside the cards, through the deploy command
   * (`watchDeploys`): the Call panel reads its IDL. No step passes on it.
   * `idl` is absent when the build returned none; the tutorial's shipped IDL
   * then stands in
   */
  | { type: "deployed"; idl?: Idl; at: number }
  /** A step's goal met outside the feed: a Call panel call or a client run */
  | {
      type: "passed";
      via: Exclude<PassedVia, "chat">;
      result: RunResult;
      at: number;
    }
  | { type: "explain"; beatId: string; at: number }
  | { type: "fixMyself"; beatId: string; at: number }
  /** The assistant's answer to an unplanned failure's Explain ended */
  | { type: "answered"; beatId: string; at: number }
  /** "Show me the fix": write the step's target into its file */
  | { type: "showFix"; beatId: string; at: number }
  | { type: "next"; at: number }
  | { type: "finish"; at: number }
  | { type: "restartStep"; at: number }
  | { type: "startOver"; at: number }
  /**
   * A typed action word (task 3.6): the action it names, and its pill when
   * that action changed something; a word the engine refuses is dropped
   */
  | { type: "word"; word: Word; text: string; then: WordAction; at: number }
  /** An action word typed while a question is open: refused, not run */
  | { type: "refuseWord"; word: Word; text: string; at: number }
  /** A finish chip pressed, by its index in the definition's `finish.chips` */
  | { type: "chip"; index: number; at: number }
  /** The assistant proposed one line's change; it waits for Apply or Keep */
  | {
      type: "propose";
      proposal: Pick<Proposal, "id" | "file" | "line" | "before" | "after">;
      at: number;
    }
  | { type: "apply"; id: string; at: number }
  /** The proposal's line was written (`apply`'s effect landed) */
  | { type: "applied"; id: string; at: number }
  | { type: "applyFailed"; id: string; reason: ApplyFailure; at: number }
  | { type: "keep"; id: string; at: number }
  /** A composer message went to the live assistant: counted, nothing saved */
  | { type: "asked"; cursor: Cursor; at: number };

/** What a typed action word may run: the same actions its buttons send */
export type WordAction = Extract<
  Action,
  { type: "start" } | { type: "act" } | { type: "next" } | { type: "explain" }
>;

export type Effect =
  | {
      kind: "write";
      beatId: string;
      file: string;
      block: string;
      /** The key line the learner typed, for a fill around it */
      key: string | null;
      /** The write's own reference and start, when the definition gives them */
      ref?: string;
      start?: string;
      at: number;
    }
  | { kind: "create"; beatId: string; path: string; at: number }
  | {
      kind: "run";
      beatId: string;
      act: Act;
      input: RunInput;
      /** Echoed back on `stage` and `ended`, so a stale run cannot answer */
      startedAt: number;
    }
  | { kind: "event"; name: "tutorial_started"; params: { tutorial: string } }
  | {
      kind: "event";
      name: "tutorial_step_reset";
      /** `step` is 1-based */
      params: { tutorial: string; step: number };
    }
  | {
      kind: "event";
      name: "tutorial_finished";
      params: { tutorial: string; seconds: number };
    }
  | {
      kind: "event";
      name: "tutorial_question_answered";
      params: {
        tutorial: string;
        question: string;
        result: QuestionResult;
        /** 1 to 3 */
        attempts: number;
      };
    }
  | {
      kind: "event";
      name: "tutorial_step_passed";
      params: {
        tutorial: string;
        /** 1-based */
        step: number;
        via: PassedVia;
        seconds: number;
        /** Only when the account the goal creates already existed */
        reason?: PassReason;
      };
    }
  | {
      kind: "event";
      name: "tutorial_action_run";
      params: ActionRunParams;
    }
  | {
      kind: "event";
      name: "tutorial_question_asked";
      /** `step` as `stepNumber` gives it: 1-based, 0 before Start, the last after the finish */
      params: { tutorial: string; step: number; source: "typed" | "chip" };
    }
  | {
      kind: "event";
      name: "tutorial_word_sent";
      params: {
        tutorial: string;
        step: number;
        word: string;
        refused: boolean;
      };
    }
  | {
      kind: "event";
      name: "tutorial_change_applied";
      params: { tutorial: string; file: string };
    }
  | {
      kind: "event";
      name: "tutorial_change_kept";
      params: { tutorial: string };
    }
  /** Write a proposal's line over `before`, unless the line moved since */
  | {
      kind: "apply";
      id: string;
      file: string;
      line: number;
      before: string;
      after: string;
    }
  /** Put the caret where the answer lands, or on the error's line */
  | { kind: "focus"; file: string; line: number | "landing" }
  /** An unplanned failure to explain through the live assistant (task 4.1) */
  | { kind: "explain"; beatId: string; result: RunResult }
  /** Whole files to put in the workspace (a step's start, or the preview),
   * and the files of the other set to take away, so a preview file never
   * survives into the lesson */
  | { kind: "restore"; files: Record<string, string>; remove: string[] };

export interface Reduced {
  state: EngineState;
  effects: Effect[];
}

const same = (state: EngineState): Reduced => ({ state, effects: [] });

/** `tutorial_action_run`'s parameters, declared once on the tutorial tracker */
export type ActionRunParams = TutorialEvents["tutorial_action_run"];

const ACTION_OF: Record<Act, ActionRunParams["action"]> = {
  airdrop: "airdrop",
  build: "build",
  deploy: "deploy",
  buildDeploy: "build_deploy",
  run: "run",
  call: "call",
};

/**
 * What the beat's last run sent, when devnet had not read it back: what
 * "Check again" reads. Null for any other last run.
 */
const unconfirmedOf = (runs: RunRecord[] | undefined): UnreadTx[] | null => {
  const last = runs?.[runs.length - 1];
  if (last?.status !== "failed") return null;
  const { result } = last;
  if (result.act !== "run" && result.act !== "call") return null;
  return !result.ok && result.reason === "unconfirmed"
    ? result.unconfirmed
    : null;
};

/** A run's outcome as `tutorial_action_run` names it */
const outcomeOf = (result: RunResult): ActionRunParams["outcome"] => {
  if (result.ok) return "ok";
  if (
    (result.act === "airdrop" ||
      result.act === "deploy" ||
      result.act === "buildDeploy") &&
    result.reason !== "failed"
  ) {
    return result.reason;
  }
  if (
    (result.act === "run" || result.act === "call") &&
    (result.reason === "no_wallet" ||
      result.reason === "no_funds" ||
      result.reason === "unconfirmed")
  ) {
    return result.reason;
  }
  return "failed";
};

/** The `tutorial_action_run` event of one run */
const actionRunOf = (
  run: { slug: string; step: number; act: Act; took: number },
  outcome: ActionRunParams["outcome"],
  action: ActionRunParams["action"] = ACTION_OF[run.act]
): Effect => ({
  kind: "event",
  name: "tutorial_action_run",
  params: {
    tutorial: run.slug,
    step: run.step,
    action,
    outcome,
    // Two devices' clocks can disagree; a run never takes negative time
    seconds: Math.max(0, Math.round(run.took / 1000)),
  },
});

/** The reduction with one more effect after its own */
const withEffect = (reduced: Reduced, effect: Effect): Reduced => ({
  state: reduced.state,
  effects: [...reduced.effects, effect],
});

/** Where a beat sits: its step, and whether in the step's planned failure */
interface Located {
  step: Step;
  beat: Beat;
  fail: boolean;
}

const beatsOf = (step: Step, fail: boolean): Beat[] =>
  fail ? step.onFail ?? [] : step.beats;

const locate = (
  definition: TutorialDefinition,
  beatId: string
): Located | null => {
  for (const step of definition.steps) {
    for (const fail of [false, true]) {
      const beat = beatsOf(step, fail).find((b) => b.id === beatId);
      if (beat) return { step, beat, fail };
    }
  }
  return null;
};

/** The step a beat belongs to, for the store's writes */
export const stepOfBeat = (
  definition: TutorialDefinition,
  beatId: string
): Step | null => locate(definition, beatId)?.step ?? null;

/** The act a beat runs, or null when the beat is not an act */
export const actOf = (
  definition: TutorialDefinition,
  beatId: string
): Act | null => {
  const found = locate(definition, beatId);
  return found && isAct(found.beat) ? found.beat.act : null;
};

const stepAt = (definition: TutorialDefinition, cursor: Cursor): Step | null =>
  cursor.kind === "step"
    ? definition.steps.find((s) => s.id === cursor.stepId) ?? null
    : null;

const isLast = (definition: TutorialDefinition, step: Step) =>
  definition.steps[definition.steps.length - 1].id === step.id;

const passed = (p: ConversationProgress, step: Step) =>
  p.passed.includes(step.id);

/** An act's latest run, the one its card shows */
const lastRun = (p: ConversationProgress, beatId: string) =>
  p.runs[beatId]?.at(-1);

/** The state with an act's latest run replaced */
const withLastRun = (
  state: EngineState,
  beatId: string,
  run: RunRecord
): EngineState => {
  const p = state.progress;
  return {
    ...state,
    progress: {
      ...p,
      runs: { ...p.runs, [beatId]: [...p.runs[beatId].slice(0, -1), run] },
    },
  };
};

/**
 * Whether a repeating act takes no more presses: its step passed, the cursor
 * is on another step, or a press met `repeat.until` and the cursor went on past
 * it. Read off the cursor, so a
 * reload needs nothing saved for it.
 */
export const hasRepeatEnded = (
  p: ConversationProgress,
  step: Step,
  beatId: string
): boolean => {
  if (passed(p, step)) return true;
  if (p.cursor.kind !== "step" || p.cursor.stepId !== step.id) return true;
  const index = beatsOf(step, p.cursor.fail).findIndex((b) => b.id === beatId);
  return index === -1 || p.cursor.beat > index + 1;
};

/** A landed run's or call's accounts, remembered for the calls after it */
const remembering = (
  p: ConversationProgress,
  result: RunResult
): ConversationProgress => {
  if ((result.act !== "run" && result.act !== "call") || !result.ok) return p;
  if (!result.wrote?.length) return p;
  return {
    ...p,
    accounts: {
      ...p.accounts,
      ...Object.fromEntries(result.wrote.map((a) => [a.name, a.address])),
    },
  };
};

/** Whether a press's result met its card's `repeat.until` */
const hasMetUntil = (ctx: EngineContext, beat: ActBeat, result: RunResult) =>
  beat.act === "call" &&
  beat.repeat?.until !== undefined &&
  ctx.judge(
    {
      kind: "call",
      instruction: beat.call.instruction,
      log: beat.repeat.until,
    },
    result
  );

/**
 * The instruction the live step's goal names, which the Call panel picks on
 * open, or undefined on a step whose goal names none (a build, a deploy, the win's
 * intro or the finish)
 */
export const liveInstruction = (
  definition: TutorialDefinition,
  cursor: Cursor
): string | undefined => {
  const goal = stepAt(definition, cursor)?.goal;
  return goal?.kind === "call" || goal?.kind === "refused"
    ? goal.instruction
    : undefined;
};

/**
 * A Call panel call's input: the deployed IDL, and the live goal's log
 * pattern when the call is of the goal's instruction, so the result's line is
 * the one the goal judges.
 */
export const panelInput = (
  definition: TutorialDefinition,
  p: ConversationProgress,
  call: NonNullable<RunInput["call"]>
): RunInput => {
  const goal = stepAt(definition, p.cursor)?.goal;
  const creates = createsOf(goal);
  return {
    beatId: "call-panel",
    call: Object.keys(p.accounts).length
      ? { ...call, accounts: p.accounts }
      : call,
    ...(p.deployed ? { idl: p.deployed.idl } : {}),
    ...(goal?.kind === "call" &&
    goal.log !== undefined &&
    sameIdlName(goal.instruction, call.instruction)
      ? { log: goal.log }
      : {}),
    ...(creates && sameIdlName(creates.instruction, call.instruction)
      ? { creates }
      : {}),
  };
};

/** A goal a failed result can pass: a refusal, or a call whose account may already exist */
const acceptsFailure = (goal: Goal): boolean =>
  goal.kind === "refused" ||
  (goal.kind === "call" && goal.creates !== undefined);

/** The live `call` goal's instruction and the account it creates, if it names one */
const createsOf = (goal: Goal | undefined): RunInput["creates"] =>
  goal?.kind === "call" && goal.creates !== undefined
    ? { instruction: goal.instruction, account: goal.creates }
    : undefined;

/** The account a call act's own instruction creates, if the act names one */
const ownCreatesOf = (beat: ActBeat): RunInput["creates"] =>
  beat.act === "call" && beat.call.creates !== undefined
    ? { instruction: beat.call.instruction, account: beat.call.creates }
    : undefined;

/** The failed run found the account the act's own call creates already there */
const hasOwnAccountThere = (beat: ActBeat, result: RunResult): boolean => {
  const own = ownCreatesOf(beat);
  const exists = existsOf(result);
  return (
    own !== undefined &&
    exists !== undefined &&
    sameIdlName(exists.instruction, own.instruction) &&
    sameIdlName(exists.account, own.account)
  );
};

/** A run in flight on an act card: the panel waits for it */
export const running = (p: ConversationProgress) =>
  Object.values(p.runs).some((rs) => rs.at(-1)?.status === "started");

const isAsk = (b: Beat): b is Ask => b.kind === "ask";
const isAct = (b: Beat): b is ActBeat => b.kind === "act";

/** A question is live only while it is open and the cursor is on its step */
const openAsk = (
  ctx: EngineContext,
  p: ConversationProgress,
  beatId: string
):
  | (Located & { beat: Ask; open: Extract<Resolution, { kind: "open" }> })
  | null => {
  const found = locate(ctx.definition, beatId);
  if (!found || !isAsk(found.beat)) return null;
  if (p.cursor.kind !== "step" || p.cursor.stepId !== found.step.id)
    return null;
  const open = p.beats[beatId];
  if (!open || open.kind !== "open") return null;
  return { ...found, beat: found.beat, open };
};

/**
 * Posts the beats from the cursor up to the first that waits for the
 * learner, a question or an act, stamping each with an `at` one tick after
 * the last. A write beat's text posts now and its block is queued. Nothing
 * posts once the step has passed.
 */
const flow = (
  ctx: EngineContext,
  p: ConversationProgress,
  at: number
): { progress: ConversationProgress; effects: Effect[] } => {
  const step = stepAt(ctx.definition, p.cursor);
  if (!step || p.cursor.kind !== "step" || passed(p, step)) {
    return { progress: p, effects: [] };
  }
  const cursor = p.cursor;
  const beats = beatsOf(step, cursor.fail);
  const resolved = { ...p.beats };
  const effects: Effect[] = [];
  let i = cursor.beat;
  let t = at;
  while (i < beats.length) {
    const b = beats[i];
    i++;
    if (b.kind === "say") {
      resolved[b.id] = { kind: "said", at: t };
      t += TICK_MS;
    } else if (b.kind === "write") {
      resolved[b.id] = { kind: "said", at: t };
      effects.push(
        "create" in b.writes
          ? { kind: "create", beatId: b.id, path: b.writes.create, at: t }
          : writeOf(b.id, b.writes, null, t)
      );
      t += TICK_MS;
    } else if (b.kind === "ask") {
      resolved[b.id] = { kind: "open", at: t, wrong: [] };
      break;
    } else {
      // The act's say and its live card arrive together
      resolved[b.id] = { kind: "said", at: t };
      break;
    }
  }
  return {
    progress: {
      ...p,
      cursor: { kind: "step", stepId: step.id, beat: i, fail: cursor.fail },
      beats: resolved,
    },
    effects,
  };
};

/** A block's write effect, carrying the block's own `ref` and `start` only
 * when the definition gives them */
const writeOf = (
  beatId: string,
  writes: Block,
  key: string | null,
  at: number
): Effect => {
  const effect: Extract<Effect, { kind: "write" }> = {
    kind: "write",
    beatId,
    file: writes.file,
    block: writes.block,
    key,
    at,
  };
  if (writes.ref !== undefined) effect.ref = writes.ref;
  if (writes.start !== undefined) effect.start = writes.start;
  return effect;
};

/** The write a resolved question's answer queues, when it has one */
const answerWrite = (ask: Ask, key: string | null, at: number): Effect[] =>
  ask.writes ? [writeOf(ask.id, ask.writes, key, at)] : [];

/**
 * The step passes: its win posts at `at`, and the questions it left open
 * resolve. A fix question (in `onFail`) passed by a build the learner fixed
 * by hand reads "typed by you"; any other open question was skipped by the
 * step passing elsewhere.
 */
const pass = (
  ctx: EngineContext,
  p: ConversationProgress,
  step: Step,
  at: number,
  via: PassedVia,
  reason: PassReason | undefined
): ConversationProgress => {
  const beats = { ...p.beats };
  for (const fail of [false, true]) {
    for (const b of beatsOf(step, fail)) {
      const r = beats[b.id];
      if (!isAsk(b) || !r || r.kind !== "open") continue;
      const base = {
        at,
        openedAt: r.at,
        wrong: r.wrong,
        ...hintOf(r),
      };
      if (fail) {
        beats[b.id] = { kind: "typed", ...base };
      } else {
        const skippedVia: SkipVia =
          via === "call_panel" ? "call_panel" : "elsewhere";
        beats[b.id] = { kind: "skipped", via: skippedVia, ...base };
      }
    }
  }
  const from = p.times[step.id]?.from ?? at;
  return {
    ...p,
    passed: p.passed.includes(step.id) ? p.passed : [...p.passed, step.id],
    times: {
      ...p.times,
      [step.id]: reason ? { from, to: at, via, reason } : { from, to: at, via },
    },
    beats,
  };
};

/**
 * Whether a failed build is the one the step plans: a compiler failure (not
 * a server that never answered) whose log holds the step's `failsWith` line,
 * before the cursor has entered `onFail`. The line, not the first error,
 * decides: the planned error may have no code, and the server may report a
 * macro symptom first. Any such build counts, so a learner who runs the build
 * again before pressing Explain meets the same explanation. Judged once,
 * when the run ends, and kept on the run record: once the cursor is in
 * `onFail`, a later failed build there is an ordinary failure.
 */
const isPlannedFailure = (
  step: Step,
  cursor: Cursor,
  result: RunResult
): boolean =>
  result.act === "build" &&
  !result.ok &&
  result.reason === "compiler" &&
  !!step.failsWith &&
  isPlannedLog(result.log, step.failsWith) &&
  !!step.onFail &&
  cursor.kind === "step" &&
  cursor.stepId === step.id &&
  !cursor.fail;

/**
 * The values a call act sends: what the learner gave, with the definition's
 * value for every argument it gives one, which no learner value overrides. A
 * value with `add` grows by it for each run of this act that landed, so a
 * refused, failed or interrupted run sends the same value again.
 */
const callArgs = (
  args: CallArg[],
  given: Record<string, string>,
  p: ConversationProgress,
  beatId: string
): Record<string, string> => {
  const landed = (p.runs[beatId] ?? []).filter((r) => r.status === "ok").length;
  const out: Record<string, string> = {};
  // The card's fields are named by `args`, so names compare exactly, as
  // `checkDefinition`'s duplicate rule does
  const fixed = new Set(
    args.flatMap((arg) => (typeof arg === "string" ? [] : [arg.name]))
  );
  for (const [name, value] of Object.entries(given)) {
    if (!fixed.has(name)) out[name] = value;
  }
  for (const arg of args) {
    if (typeof arg === "string") continue;
    out[arg.name] =
      arg.add === undefined
        ? String(arg.value)
        : String(arg.value + arg.add * landed);
  }
  return out;
};

/** The index of the fix question in `onFail`, past its leading explanation */
const fixQuestionIndex = (step: Step): number => {
  const i = (step.onFail ?? []).findIndex((b) => b.kind !== "say");
  return i === -1 ? 0 : i;
};

/** Every file the lesson's steps start or end with */
const lessonFiles = (definition: TutorialDefinition): Set<string> =>
  new Set(
    definition.steps.flatMap((s) => [
      ...Object.keys(s.start),
      ...Object.keys(s.target),
    ])
  );

/**
 * The preview's files the first step does not start with: taken away on
 * Start, so a file a later step creates (Hello Anchor's `client.ts`) is not
 * already there, finished, when that step's `create` beat and question come.
 * A later step that starts with a file no beat created writes into an
 * absent file, which `insertBlock` treats as empty.
 */
const previewOnly = (definition: TutorialDefinition): string[] =>
  Object.keys(definition.intro.files).filter(
    (path) => !(path in definition.steps[0].start)
  );

/** The lesson's files the preview does not hold: taken away on Start over */
const lessonOnly = (definition: TutorialDefinition): string[] =>
  [...lessonFiles(definition)].filter(
    (path) => !(path in definition.intro.files)
  );

const withProgress = (
  state: EngineState,
  progress: ConversationProgress,
  effects: Effect[] = []
): Reduced => ({ state: { ...state, progress }, effects });

/**
 * The step passes on `result` (see `pass`), and `tutorial_step_passed` says
 * how, how long, and when the account the goal creates already existed
 */
const passStep = (
  ctx: EngineContext,
  state: EngineState,
  p: ConversationProgress,
  step: Step,
  at: number,
  via: PassedVia,
  result: RunResult
): Reduced => {
  const from = p.times[step.id]?.from ?? at;
  const reason: PassReason | undefined = existsOf(result)
    ? "exists"
    : undefined;
  return withProgress(state, pass(ctx, p, step, at, via, reason), [
    {
      kind: "event",
      name: "tutorial_step_passed",
      params: {
        tutorial: ctx.slug,
        step: ctx.definition.steps.indexOf(step) + 1,
        via,
        // Two devices' clocks can disagree; a pass never takes negative time
        seconds: Math.max(0, Math.round((at - from) / 1000)),
        ...(reason ? { reason } : {}),
      },
    },
  ]);
};

/**
 * One `tutorial_question_answered` per question the action took out of
 * `open`, whichever way: a pick, Skip, typing, or a step passed elsewhere.
 * Read off the progress rather than raised in each case, so a new path to a
 * resolution cannot forget to count it. A pick counts its own attempts; any
 * other ending counts the wrong picks before it plus one, at most three.
 */
const answeredEvents = (
  ctx: EngineContext,
  before: ConversationProgress,
  after: ConversationProgress
): Effect[] => {
  const events: Effect[] = [];
  for (const [id, was] of Object.entries(before.beats)) {
    const now = after.beats[id];
    if (was?.kind !== "open" || !now || now.kind === "open") continue;
    const result = answerOf(now);
    if (!result) continue;
    const attempts =
      now.kind === "picked" ? now.attempts : Math.min(3, was.wrong.length + 1);
    events.push({
      kind: "event",
      name: "tutorial_question_answered",
      params: { tutorial: ctx.slug, question: id, result, attempts },
    });
  }
  return events;
};

/** The step a lesson event names: 1-based, 0 before Start, the last after
 * the finish */
const stepNumber = (definition: TutorialDefinition, cursor: Cursor) => {
  if (cursor.kind === "intro") return 0;
  if (cursor.kind === "finished") return definition.steps.length;
  return definition.steps.findIndex((s) => s.id === cursor.stepId) + 1;
};

const wordSent = (
  ctx: EngineContext,
  cursor: Cursor,
  action: Extract<Action, { type: "word" | "refuseWord" }>
): Effect => ({
  kind: "event",
  name: "tutorial_word_sent",
  params: {
    tutorial: ctx.slug,
    step: stepNumber(ctx.definition, cursor),
    word: action.word,
    refused: action.type === "refuseWord",
  },
});

/**
 * What answers an open proposal's Apply or Keep it: `applied` and `keep`
 * settle it; `applyFailed` leaves it open, with the reason
 */
type Settling = Extract<Action, { type: "applied" | "applyFailed" | "keep" }>;

/** A proposal once Apply landed, failed, or Keep it was pressed */
const settle = (proposal: Proposal, action: Settling): Proposal => {
  const base: Proposal = {
    id: proposal.id,
    file: proposal.file,
    line: proposal.line,
    before: proposal.before,
    after: proposal.after,
    at: proposal.at,
    state: proposal.state,
  };
  if (action.type === "applied") {
    return { ...base, state: "applied", settledAt: action.at };
  }
  if (action.type === "keep") {
    return { ...base, state: "kept", settledAt: action.at };
  }
  return { ...base, applyFailed: action.reason };
};

const settledEvents = (
  ctx: EngineContext,
  proposal: Proposal,
  how: "applied" | "applyFailed" | "keep"
): Effect[] => {
  if (how === "applied") {
    return [
      {
        kind: "event",
        name: "tutorial_change_applied",
        params: { tutorial: ctx.slug, file: proposal.file },
      },
    ];
  }
  if (how === "keep") {
    return [
      {
        kind: "event",
        name: "tutorial_change_kept",
        params: { tutorial: ctx.slug },
      },
    ];
  }
  return [];
};

/**
 * A landed deploy's IDL, out of the result that goes on into the record: the
 * tutorial's shipped one where it ships one, else the build's. Shipped as of
 * the step whose act deployed, not the cursor's: a deploy recognised after
 * the learner moved on deployed that step's program.
 */
const takeDeployedIdl = (
  ctx: EngineContext,
  state: EngineState,
  action: Action
): { action: Action; idl?: Idl } => {
  if (action.type !== "ended" && action.type !== "recognised")
    return { action };
  const { result } = action;
  if (!result.ok || (result.act !== "deploy" && result.act !== "buildDeploy"))
    return { action };
  const { idl: built, ...rest } = result;
  const deployedAt = locate(ctx.definition, action.beatId)?.step.id;
  const shipped = deployedAt
    ? shippedIdlAt(ctx.definition, deployedAt)
    : shippedIdl(ctx.definition, state.progress.cursor);
  const idl = shipped ?? built;
  return idl ? { action: { ...action, result: rest }, idl } : { action };
};

export const reduce = (
  ctx: EngineContext,
  state: EngineState,
  action: Action
): Reduced => {
  const { action: plain, idl } = takeDeployedIdl(ctx, state, action);
  const raw = reduceAction(ctx, state, plain);
  // Kept only if the engine took the run: a result it dropped landed nothing
  const reduced =
    idl && raw.state.progress !== state.progress
      ? {
          ...raw,
          state: {
            ...raw.state,
            progress: {
              ...raw.state.progress,
              deployed: nextDeployed(state.progress.deployed, idl),
            },
          },
        }
      : raw;
  if (reduced.state.progress === state.progress) return reduced;
  const answered = answeredEvents(ctx, state.progress, reduced.state.progress);
  return answered.length
    ? { state: reduced.state, effects: [...reduced.effects, ...answered] }
    : reduced;
};

const reduceAction = (
  ctx: EngineContext,
  state: EngineState,
  action: Action
): Reduced => {
  const { definition } = ctx;
  const p = state.progress;

  switch (action.type) {
    case "start": {
      if (p.cursor.kind !== "intro") return same(state);
      const first = definition.steps[0];
      const started: ConversationProgress = {
        ...p,
        startedAt: action.at,
        cursor: { kind: "step", stepId: first.id, beat: 0, fail: false },
        times: { ...p.times, [first.id]: { from: action.at, to: null } },
      };
      const flowed = flow(ctx, started, action.at);
      return withProgress(state, flowed.progress, [
        // The workspace swaps the preview for the first step's start files
        {
          kind: "restore",
          files: first.start,
          remove: previewOnly(definition),
        },
        {
          kind: "event",
          name: "tutorial_started",
          params: { tutorial: ctx.slug },
        },
        ...flowed.effects,
      ]);
    }

    case "pick": {
      const live = openAsk(ctx, p, action.beatId);
      if (!live) return same(state);
      const { beat: ask, open } = live;
      if (action.option !== ask.answer) {
        if (open.wrong.includes(action.option)) return same(state);
        return withProgress(state, {
          ...p,
          beats: {
            ...p.beats,
            [ask.id]: { ...open, wrong: [...open.wrong, action.option] },
          },
        });
      }
      const picked: Resolution = {
        kind: "picked",
        at: action.at,
        openedAt: open.at,
        option: action.option,
        attempts: open.wrong.length + 1,
        wrong: open.wrong,
        ...hintOf(open),
      };
      const flowed = flow(
        ctx,
        { ...p, beats: { ...p.beats, [ask.id]: picked } },
        action.at + TICK_MS
      );
      return withProgress(state, flowed.progress, [
        ...answerWrite(ask, null, action.at),
        ...flowed.effects,
      ]);
    }

    case "hint": {
      const live = openAsk(ctx, p, action.beatId);
      if (!live || live.open.hintedAt) return same(state);
      return withProgress(state, {
        ...p,
        beats: {
          ...p.beats,
          [live.beat.id]: action.byAssistant
            ? { ...live.open, hintedAt: action.at, hintByAssistant: true }
            : { ...live.open, hintedAt: action.at },
        },
      });
    }

    case "skip": {
      const live = openAsk(ctx, p, action.beatId);
      if (!live) return same(state);
      const { beat: ask, open } = live;
      const skipped: Resolution = {
        kind: "skipped",
        at: action.at,
        openedAt: open.at,
        via: "button",
        wrong: open.wrong,
        ...hintOf(open),
      };
      const flowed = flow(
        ctx,
        { ...p, beats: { ...p.beats, [ask.id]: skipped } },
        action.at + TICK_MS
      );
      return withProgress(state, flowed.progress, [
        ...answerWrite(ask, null, action.at),
        ...flowed.effects,
      ]);
    }

    case "typeIt": {
      const live = openAsk(ctx, p, action.beatId);
      if (!live || !live.beat.writes) return same(state);
      return {
        state,
        effects: [
          { kind: "focus", file: live.beat.writes.file, line: "landing" },
        ],
      };
    }

    case "edit": {
      // The open question whose block lands in this file, if any
      const step = stepAt(definition, p.cursor);
      if (!step || p.cursor.kind !== "step") return same(state);
      const ask = beatsOf(step, p.cursor.fail).find(
        (b): b is Ask =>
          isAsk(b) &&
          b.writes?.file === action.file &&
          p.beats[b.id]?.kind === "open"
      );
      if (!ask || !ask.writes) return same(state);
      const open = p.beats[ask.id] as Extract<Resolution, { kind: "open" }>;
      const whole = holds(action.content, ask.writes.block);
      const key = keyOf(ask);
      const typed =
        !whole && key !== null && typedKey(action.content, key) !== null;
      if (!whole && !typed) return same(state);
      const resolved: Resolution = {
        kind: "typed",
        at: action.at,
        openedAt: open.at,
        wrong: open.wrong,
        ...hintOf(open),
      };
      const flowed = flow(
        ctx,
        { ...p, beats: { ...p.beats, [ask.id]: resolved } },
        action.at + TICK_MS
      );
      return withProgress(state, flowed.progress, [
        ...(typed ? answerWrite(ask, key, action.at) : []),
        ...flowed.effects,
      ]);
    }

    case "written": {
      const r = p.beats[action.beatId];
      if (!r) return same(state);
      let next: Resolution;
      if (r.kind === "said") {
        next = { kind: "written", at: r.at, wrote: action.wrote };
      } else if (
        r.kind === "picked" ||
        r.kind === "typed" ||
        r.kind === "skipped"
      ) {
        const { writeFailed: _failed, ...rest } = r;
        next = { ...rest, wrote: action.wrote };
      } else {
        return same(state);
      }
      return withProgress(state, {
        ...p,
        beats: { ...p.beats, [action.beatId]: next },
      });
    }

    case "act": {
      const found = locate(definition, action.beatId);
      if (!found || !isAct(found.beat)) return same(state);
      const { step, beat } = found;
      if (p.cursor.kind !== "step" || p.cursor.stepId !== step.id)
        return same(state);
      if (!p.beats[beat.id] || passed(p, step) || running(p))
        return same(state);
      if (beat.repeat && hasRepeatEnded(p, step, beat.id)) return same(state);
      const unread = action.recheck ? unconfirmedOf(p.runs[beat.id]) : null;
      if (action.recheck && !unread) return same(state);
      // A run that ended well may run again while the step has not passed:
      // its result may have failed the goal (a call before the upgrade)
      const input: RunInput = { beatId: beat.id };
      if (beat.account) input.account = beat.account.name;
      if (p.deployed) input.idl = p.deployed.idl;
      if (step.goal.kind === "call" && step.goal.log !== undefined) {
        input.log = step.goal.log;
      }
      // The act's own one-time call names its account before the goal's does
      const creates = ownCreatesOf(beat) ?? createsOf(step.goal);
      if (creates && (beat.act === "run" || beat.act === "call")) {
        input.creates = creates;
      }
      // The planned failure is a build of the step's own beats; the second
      // build, inside `onFail`, shows whatever error it meets
      if (beat.act === "build" && step.failsWith && !found.fail) {
        input.failsWith = step.failsWith;
      }
      if (beat.act === "call") {
        input.call = {
          instruction: beat.call.instruction,
          args: callArgs(beat.call.args ?? [], action.args ?? {}, p, beat.id),
        };
        if (Object.keys(p.accounts).length) input.call.accounts = p.accounts;
        // The press's line is what `until` reads, so it must pick it
        if (beat.repeat?.until !== undefined) input.log = beat.repeat.until;
      }
      if (unread) input.recheck = unread;
      return {
        state: {
          progress: {
            ...p,
            runs: {
              ...p.runs,
              [beat.id]: [
                ...(p.runs[beat.id] ?? []),
                { status: "started", at: action.at },
              ],
            },
          },
          stage: null,
        },
        effects: [
          {
            kind: "run",
            beatId: beat.id,
            act: beat.act,
            input,
            startedAt: action.at,
          },
        ],
      };
    }

    case "writeFailed": {
      const r = p.beats[action.beatId];
      if (!r || r.kind === "open" || r.kind === "written") return same(state);
      return withProgress(state, {
        ...p,
        beats: { ...p.beats, [action.beatId]: { ...r, writeFailed: true } },
      });
    }

    case "stage": {
      const run = lastRun(p, action.beatId);
      if (!run || run.status !== "started") return same(state);
      if (action.startedAt !== undefined && action.startedAt !== run.at) {
        return same(state);
      }
      const { beatId, label, index, count, detail } = action;
      return {
        state: { ...state, stage: { beatId, label, index, count, detail } },
        effects: [],
      };
    }

    case "ended": {
      const run = lastRun(p, action.beatId);
      const found = locate(definition, action.beatId);
      if (!run || run.status !== "started" || !found || !isAct(found.beat)) {
        return same(state);
      }
      if (action.startedAt !== undefined && action.startedAt !== run.at) {
        return same(state);
      }
      const { step, beat } = found;
      const took = action.at - run.at;
      const result = action.result;
      // A failure the step's goal accepts (a refusal it names, or the account
      // it creates already there) is its own outcome: it passes the step
      // below, and is no failure to explain
      const refused =
        !result.ok &&
        acceptsFailure(step.goal) &&
        !passed(p, step) &&
        ctx.judge(step.goal, result);
      // The account the act's own one-time call creates was already there (a
      // second pass with the same wallet): nothing to fix, so the lesson goes
      // on as if it had landed, and the step still waits on its goal
      const isExisting =
        !result.ok && !refused && hasOwnAccountThere(beat, result);
      const measured = actionRunOf(
        {
          slug: ctx.slug,
          step: definition.steps.indexOf(step) + 1,
          act: beat.act,
          took,
        },
        outcomeOf(result)
      );
      let record: RunRecord;
      if (result.ok) {
        record = { status: "ok", at: run.at, took, result };
      } else if (refused || isExisting) {
        record = { status: "refused", at: run.at, took, result };
      } else if (isPlannedFailure(step, p.cursor, result)) {
        record = { status: "failed", at: run.at, took, result, planned: true };
      } else {
        record = { status: "failed", at: run.at, took, result };
      }
      const recorded: ConversationProgress = remembering(
        {
          ...p,
          runs: {
            ...p.runs,
            [beat.id]: [...p.runs[beat.id].slice(0, -1), record],
          },
        },
        result
      );
      const cleared: EngineState = { progress: recorded, stage: null };
      if (!result.ok && !refused && !isExisting) {
        return withEffect(same(cleared), measured);
      }
      if (
        refused ||
        (!passed(recorded, step) && ctx.judge(step.goal, result))
      ) {
        const via: PassedVia = beat.act === "run" ? "client" : "chat";
        return withEffect(
          passStep(ctx, cleared, recorded, step, action.at, via, result),
          measured
        );
      }
      // A repeating card holds the lesson until a press meets its `until`
      if (beat.repeat && !hasMetUntil(ctx, beat, result)) {
        return withEffect(same(cleared), measured);
      }
      // Only the act the cursor just passed moves the lesson on: a run that
      // outlived its step, or a run again of an act the flow already went
      // past (its first result failed the goal), records its result and
      // posts nothing, so an open question is never skipped
      const index = beatsOf(step, found.fail).findIndex(
        (b) => b.id === beat.id
      );
      if (
        p.cursor.kind !== "step" ||
        p.cursor.stepId !== step.id ||
        p.cursor.fail !== found.fail ||
        p.cursor.beat !== index + 1
      ) {
        return withEffect(same(cleared), measured);
      }
      const flowed = flow(ctx, recorded, action.at + TICK_MS);
      return withEffect(
        withProgress(cleared, flowed.progress, flowed.effects),
        measured
      );
    }

    case "interrupted": {
      const effects = action.beatIds.flatMap((beatId): Effect[] => {
        const found = locate(definition, beatId);
        if (!found || !isAct(found.beat)) return [];
        return [
          actionRunOf(
            {
              slug: ctx.slug,
              step: definition.steps.indexOf(found.step) + 1,
              act: found.beat.act,
              took: 0,
            },
            "interrupted"
          ),
        ];
      });
      return { state, effects };
    }

    case "deployed": {
      const idl = shippedIdl(definition, p.cursor) ?? action.idl;
      if (!idl) return same(state);
      const deployed = nextDeployed(p.deployed, idl);
      // The same IDL again leaves the save as it was
      if (
        p.deployed &&
        JSON.stringify(p.deployed) === JSON.stringify(deployed)
      ) {
        return same(state);
      }
      return withProgress(state, { ...p, deployed });
    }

    case "recognised": {
      const run = lastRun(p, action.beatId);
      if (!run || run.status !== "interrupted") return same(state);
      // A result of another act cannot stand for this beat's run
      if (actOf(definition, action.beatId) !== action.result.act) {
        return same(state);
      }
      // Back to in flight, so the result goes through `ended`'s one path:
      // the record, the judge, the flow and the measure
      const resumed: EngineState = {
        progress: {
          ...p,
          runs: {
            ...p.runs,
            [action.beatId]: [
              ...p.runs[action.beatId].slice(0, -1),
              { status: "started", at: run.at },
            ],
          },
        },
        stage: null,
      };
      const ended = reduce(ctx, resumed, {
        type: "ended",
        beatId: action.beatId,
        startedAt: run.at,
        result: action.result,
        // The run ended when the chain says, not when the reload found it:
        // its record and its measure take the run's own time, not the gap
        at: run.at + Math.round(action.result.seconds * 1000),
      });
      // `ended` refused it (not an act, or gone from the definition)
      return ended.state === resumed ? same(state) : ended;
    }

    case "passed": {
      const known = remembering(p, action.result);
      const step = stepAt(definition, p.cursor);
      const unmoved = known === p ? same(state) : withProgress(state, known);
      const reduced =
        !step || passed(p, step) || !ctx.judge(step.goal, action.result)
          ? unmoved
          : passStep(
              ctx,
              state,
              known,
              step,
              action.at,
              action.via,
              action.result
            );
      if (action.via !== "call_panel") return reduced;
      // Every call from the panel counts, one that passes nothing too
      return withEffect(
        reduced,
        actionRunOf(
          {
            slug: ctx.slug,
            // On a win or the finish: the last step the learner reached
            step: step
              ? definition.steps.indexOf(step) + 1
              : definition.steps.length,
            act: "call",
            took: action.result.seconds * 1000,
          },
          outcomeOf(action.result),
          "call_panel"
        )
      );
    }

    case "explain": {
      const run = lastRun(p, action.beatId);
      const found = locate(definition, action.beatId);
      if (!run || run.status !== "failed" || !found) return same(state);
      // Only the live step's failure is anyone's to explain
      if (p.cursor.kind !== "step" || p.cursor.stepId !== found.step.id) {
        return same(state);
      }
      if (passed(p, found.step)) return same(state);
      if (!run.planned || p.cursor.fail) {
        // Asked once: the card closes on the press. A server that never
        // answered, one that asks for a sign-in, or a devnet that has not
        // read the transaction back yet has nothing to explain; its card
        // offers the way on instead
        if (
          run.explainedAt !== undefined ||
          isUnreachable(run.result) ||
          isSignedOut(run.result) ||
          isUnconfirmed(run.result)
        ) {
          return same(state);
        }
        return {
          state: withLastRun(state, action.beatId, {
            ...run,
            explainedAt: action.at,
          }),
          effects: [
            { kind: "explain", beatId: action.beatId, result: run.result },
          ],
        };
      }
      const flowed = flow(
        ctx,
        {
          ...p,
          cursor: { kind: "step", stepId: found.step.id, beat: 0, fail: true },
        },
        action.at
      );
      return withProgress(state, flowed.progress, flowed.effects);
    }

    case "answered": {
      const run = lastRun(p, action.beatId);
      if (
        !run ||
        run.status !== "failed" ||
        run.explainedAt === undefined ||
        run.answeredAt !== undefined
      ) {
        return same(state);
      }
      return {
        state: withLastRun(state, action.beatId, {
          ...run,
          answeredAt: action.at,
        }),
        effects: [],
      };
    }

    case "showFix": {
      const run = lastRun(p, action.beatId);
      const found = locate(definition, action.beatId);
      if (!run || run.status !== "failed" || run.fixedAt !== undefined) {
        return same(state);
      }
      // An explained build failure, or a call the program could not match,
      // which nothing explains first
      const mismatch = isMismatch(run.result);
      if (
        !found ||
        (!mismatch &&
          (run.result.act !== "build" || run.explainedAt === undefined))
      ) {
        return same(state);
      }
      const { step } = found;
      if (p.cursor.kind !== "step" || p.cursor.stepId !== step.id) {
        return same(state);
      }
      // A mismatch is the program's, whatever the step's own file: restoring
      // the client would mark it fixed and change nothing
      const file = mismatch ? PROGRAM_FILE : step.file;
      const target = step.target[file];
      if (passed(p, step) || target === undefined) return same(state);
      return {
        state: withLastRun(state, action.beatId, {
          ...run,
          fixedAt: action.at,
        }),
        effects: [{ kind: "restore", files: { [file]: target }, remove: [] }],
      };
    }

    case "fixMyself": {
      const run = lastRun(p, action.beatId);
      const found = locate(definition, action.beatId);
      if (!run || run.status !== "failed" || !found) return same(state);
      if (p.cursor.kind !== "step" || p.cursor.stepId !== found.step.id) {
        return same(state);
      }
      if (passed(p, found.step)) return same(state);
      const focus: Effect = {
        kind: "focus",
        file: found.step.file,
        line:
          run.result.act === "build" && !run.result.ok && run.result.error?.line
            ? run.result.error.line
            : "landing",
      };
      if (!run.planned || p.cursor.fail) {
        return { state, effects: [focus] };
      }
      // The fix question still follows; the explanation before it is skipped
      const flowed = flow(
        ctx,
        {
          ...p,
          cursor: {
            kind: "step",
            stepId: found.step.id,
            beat: fixQuestionIndex(found.step),
            fail: true,
          },
        },
        action.at
      );
      return withProgress(state, flowed.progress, [focus, ...flowed.effects]);
    }

    case "next": {
      const step = stepAt(definition, p.cursor);
      if (!step || !passed(p, step) || isLast(definition, step))
        return same(state);
      const i = definition.steps.findIndex((s) => s.id === step.id);
      const next = definition.steps[i + 1];
      const entered: ConversationProgress = {
        ...p,
        cursor: { kind: "step", stepId: next.id, beat: 0, fail: false },
        times: { ...p.times, [next.id]: { from: action.at, to: null } },
      };
      const flowed = flow(ctx, entered, action.at);
      return withProgress(state, flowed.progress, flowed.effects);
    }

    case "finish": {
      const step = stepAt(definition, p.cursor);
      if (!step || !passed(p, step) || !isLast(definition, step))
        return same(state);
      if (p.finishedAt !== null) return same(state);
      const seconds = Math.round(
        (action.at - (p.startedAt ?? action.at)) / 1000
      );
      return withProgress(
        state,
        { ...p, cursor: { kind: "finished" }, finishedAt: action.at },
        [
          {
            kind: "event",
            name: "tutorial_finished",
            params: { tutorial: ctx.slug, seconds },
          },
        ]
      );
    }

    case "restartStep": {
      // The appended wrote card's Reset: the step as Start or Next left it,
      // the learner's own lines gone with the blocks written since
      const step = stepAt(definition, p.cursor);
      if (!step || passed(p, step) || running(p)) return same(state);
      const ids = new Set(
        [...step.beats, ...(step.onFail ?? [])].map((b) => b.id)
      );
      const without = <T>(records: Record<string, T>) =>
        Object.fromEntries(
          Object.entries(records).filter(([id]) => !ids.has(id))
        );
      const restarted: ConversationProgress = {
        ...p,
        cursor: { kind: "step", stepId: step.id, beat: 0, fail: false },
        beats: without(p.beats),
        runs: without(p.runs),
        times: { ...p.times, [step.id]: { from: action.at, to: null } },
      };
      const flowed = flow(ctx, restarted, action.at);
      return withProgress(state, flowed.progress, [
        {
          kind: "restore",
          files: step.start,
          // A file the step creates, such as client.ts, goes until its
          // write comes round again
          remove: Object.keys(step.target).filter((f) => !(f in step.start)),
        },
        {
          kind: "event",
          name: "tutorial_step_reset",
          params: {
            tutorial: ctx.slug,
            step: definition.steps.findIndex((s) => s.id === step.id) + 1,
          },
        },
        ...flowed.effects,
      ]);
    }

    case "word": {
      const ran = reduceAction(ctx, state, action.then);
      if (ran.state.progress === p && ran.effects.length === 0) {
        return same(state);
      }
      const q = ran.state.progress;
      return {
        state: {
          progress: {
            ...q,
            said: [
              ...q.said,
              { kind: "word", text: action.text, at: action.at },
            ],
          },
          stage: ran.state.stage,
        },
        effects: [wordSent(ctx, p.cursor, action), ...ran.effects],
      };
    }

    case "refuseWord":
      return withProgress(
        state,
        {
          ...p,
          said: [
            ...p.said,
            { kind: "refused", text: action.text, at: action.at },
          ],
        },
        [wordSent(ctx, p.cursor, action)]
      );

    case "chip": {
      if (p.cursor.kind !== "finished") return same(state);
      if (!definition.finish.chips[action.index]) return same(state);
      return withProgress(
        state,
        {
          ...p,
          said: [
            ...p.said,
            { kind: "chip", index: action.index, at: action.at },
          ],
        },
        [
          {
            kind: "event",
            name: "tutorial_question_asked",
            params: {
              tutorial: ctx.slug,
              step: stepNumber(definition, p.cursor),
              source: "chip",
            },
          },
        ]
      );
    }

    case "propose": {
      if (p.proposals.some((x) => x.id === action.proposal.id)) {
        return same(state);
      }
      const proposal: Proposal = {
        id: action.proposal.id,
        file: action.proposal.file,
        line: action.proposal.line,
        before: action.proposal.before,
        after: action.proposal.after,
        at: action.at,
        state: "open",
      };
      return withProgress(state, {
        ...p,
        proposals: [...p.proposals, proposal],
      });
    }

    case "apply": {
      const proposal = p.proposals.find((x) => x.id === action.id);
      if (!proposal || proposal.state !== "open") return same(state);
      return {
        state,
        effects: [
          {
            kind: "apply",
            id: proposal.id,
            file: proposal.file,
            line: proposal.line,
            before: proposal.before,
            after: proposal.after,
          },
        ],
      };
    }

    case "applied":
    case "applyFailed":
    case "keep": {
      const proposal = p.proposals.find((x) => x.id === action.id);
      if (!proposal || proposal.state !== "open") return same(state);
      const settled = settle(proposal, action);
      return withProgress(
        state,
        {
          ...p,
          proposals: p.proposals.map((x) => (x.id === action.id ? settled : x)),
        },
        settledEvents(ctx, proposal, action.type)
      );
    }

    case "asked":
      return {
        state,
        effects: [
          {
            kind: "event",
            name: "tutorial_question_asked",
            params: {
              tutorial: ctx.slug,
              step: stepNumber(definition, action.cursor),
              source: "typed",
            },
          },
        ],
      };

    case "startOver":
      // Never a no-op: on a failed load the intro shows too, and this is the
      // learner's way out of it
      return {
        state: { progress: freshProgress(action.at), stage: null },
        effects: [
          {
            kind: "restore",
            files: definition.intro.files,
            remove: lessonOnly(definition),
          },
        ],
      };
  }
};

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;
  type Refusal = import("./progress").Refusal;

  describe("features/tutorial-conversation/model/reducer", () => {
    let hello: TutorialDefinition;
    let judgeGoal: typeof import("./goals").judgeGoal;
    beforeAll(async () => {
      const shipped = (
        await import("../../../tutorials/hello-anchor/tutorial.json")
      ).default as unknown as TutorialDefinition;
      // Without its shipped IDLs, so a deploy keeps the IDL it brought; the
      // shipped ones are "a tutorial that ships its IDL"
      hello = structuredClone(shipped);
      for (const step of hello.steps) delete step.idl;
      judgeGoal = (await import("./goals")).judgeGoal;
    });

    const ctx = (): EngineContext => ({
      definition: hello,
      slug: "hello-anchor",
      // Any ok run passes, except an airdrop, which passes no goal
      // (`judgeGoal`): it only funds the deploy after it
      judge: (_goal, result) => result.ok && result.act !== "airdrop",
    });

    /** Folds the actions from the initial state, collecting every effect */
    const play = (actions: Action[], from = INITIAL_ENGINE_STATE) => {
      const c = ctx();
      let state = from;
      const effects: Effect[] = [];
      for (const a of actions) {
        const r = reduce(c, state, a);
        state = r.state;
        effects.push(...r.effects);
      }
      return { state, progress: state.progress, effects };
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
      seconds: 1.2,
      reason: "compiler",
      error: {
        code: "E0412",
        file: "src/lib.rs",
        line: 9,
        column: 32,
        message: "cannot find type `Hello` in this scope",
      },
      log: "error[E0412]: cannot find type `Hello` in this scope",
    };
    const FAILED_DEPLOY: RunResult = {
      act: "deploy",
      ok: false,
      seconds: 1,
      reason: "failed",
      message: "unused",
    };
    const AIRDROPPED: RunResult = {
      act: "airdrop",
      ok: true,
      seconds: 1,
      balance: 2_000_000_000,
      airdropped: 2_000_000_000,
    };
    const DEPLOYED: RunResult = {
      act: "deploy",
      ok: true,
      seconds: 2,
      programId: "p",
      signature: "s",
      upgraded: false,
      lamports: 1,
      instructions: ["hello"],
    };

    const start: Action = { type: "start", at: 1000 };
    const rightPick: Action = {
      type: "pick",
      beatId: "s1.q1",
      option: 1,
      at: 5000,
    };
    const build = (at: number): Action => ({
      type: "act",
      beatId: "s1.build",
      at,
    });

    describe("a repeating call act", () => {
      const callOk = (line: string, over: object = {}): RunResult =>
        Object.assign(
          {
            act: "call" as const,
            ok: true as const,
            seconds: 1,
            signatures: ["5ig"],
            line,
            called: [{ instruction: "grow", args: {} }],
          },
          over
        );
      const REFUSED: RunResult = {
        act: "call",
        ok: false,
        seconds: 1,
        message: "out",
        log: "memory allocation failed",
        refused: { instruction: "grow", error: null },
      };

      /** A step of a card that grows, then a card that paints */
      const growing = (repeat: ActBeat["repeat"]): EngineContext => {
        const d = JSON.parse(JSON.stringify(hello)) as TutorialDefinition;
        const card = (id: string, instruction: string): Beat => ({
          kind: "act",
          id,
          act: "call",
          title: id,
          context: id,
          button: id,
          call: {
            instruction,
            args: [{ name: "len", value: 20480, add: 10240 }],
          },
        });
        const grow = card("s1.grow", "grow");
        if (grow.kind === "act") grow.repeat = repeat;
        d.steps[0].beats = repeat?.until
          ? [grow, card("s1.paint", "paint")]
          : [grow];
        d.steps[0].goal = repeat?.until
          ? { kind: "call", instruction: "paint" }
          : { kind: "refused", instruction: "grow", log: "allocation" };
        return { definition: d, slug: "x", judge: judgeGoal };
      };

      /** Folds the actions, and returns the run effects' inputs too */
      const walk = (c: EngineContext, actions: Action[]) => {
        let state = INITIAL_ENGINE_STATE;
        const inputs: RunInput[] = [];
        for (const a of actions) {
          const r = reduce(c, state, a);
          state = r.state;
          for (const e of r.effects) if (e.kind === "run") inputs.push(e.input);
        }
        return { progress: state.progress, inputs };
      };
      const press = (at: number, beatId = "s1.grow"): Action => ({
        type: "act",
        beatId,
        at,
      });
      const ended = (at: number, result: RunResult): Action => ({
        type: "ended",
        beatId: "s1.grow",
        result,
        at,
      });

      it("holds the lesson on a press that landed, and grows the next press's value", () => {
        const { progress, inputs } = walk(
          growing({ label: "Grow to 40 KB", until: "is 40960 bytes" }),
          [
            start,
            press(2000),
            ended(3000, callOk("The map is 20480 bytes")),
            press(4000),
          ]
        );
        expect(progress.beats["s1.paint"]).toBeUndefined();
        expect(progress.runs["s1.grow"]).toHaveLength(2);
        expect(inputs.map((i) => i.call?.args.len)).toEqual(["20480", "30720"]);
      });

      it("picks the press's line with the card's until", () => {
        const { inputs } = walk(
          growing({ label: "Grow to 40 KB", until: "is 40960 bytes" }),
          [start, press(2000)]
        );
        expect(inputs[0].log).toBe("is 40960 bytes");
      });

      it("flows on when a press meets until, and takes no more presses", () => {
        const c = growing({ label: "Grow to 40 KB", until: "is 40960 bytes" });
        const { progress, inputs } = walk(c, [
          start,
          press(2000),
          ended(3000, callOk("The map is 40960 bytes")),
          press(9000),
        ]);
        expect(progress.beats["s1.paint"]).toBeDefined();
        expect(progress.runs["s1.grow"]).toHaveLength(1);
        expect(inputs).toHaveLength(1);
        expect(progress.passed).toEqual([]);
      });

      it("passes the step on the refusal its goal names, with no until", () => {
        const { progress } = walk(growing({ label: "Grow until out" }), [
          start,
          press(2000),
          ended(3000, callOk("The map is 20480 bytes")),
          press(4000),
          ended(5000, REFUSED),
        ]);
        expect(progress.passed).toEqual(["write-program"]);
        expect(progress.runs["s1.grow"].map((r) => r.status)).toEqual([
          "ok",
          "refused",
        ]);
      });

      describe("Check again on a call devnet has not confirmed", () => {
        const UNREAD = [
          {
            signature: "late",
            calls: [{ instruction: "grow", args: {}, accounts: [], wrote: [] }],
          },
        ];
        const UNCONFIRMED: RunResult = {
          act: "call",
          ok: false,
          seconds: 4,
          reason: "unconfirmed",
          message:
            "Devnet has not confirmed this transaction yet. Check again, or open it in Explorer.",
          log: "",
          unconfirmed: UNREAD,
        };
        /** One plain call whose goal is the call itself */
        const calling = () => {
          const c = growing(undefined);
          c.definition.steps[0].goal = { kind: "call", instruction: "grow" };
          return c;
        };
        const recheck = (at: number): Action => ({
          type: "act",
          beatId: "s1.grow",
          recheck: true,
          at,
        });

        it("reads the sent transactions again instead of sending, and passes once they land", () => {
          const { progress, inputs } = walk(calling(), [
            start,
            press(2000),
            ended(3000, UNCONFIRMED),
            recheck(4000),
            ended(5000, callOk("Program log: grown")),
          ]);
          expect(inputs).toHaveLength(2);
          expect(inputs[0]).not.toHaveProperty("recheck");
          expect(inputs[1].recheck).toEqual(UNREAD);
          expect(progress.runs["s1.grow"].map((r) => r.status)).toEqual([
            "failed",
            "ok",
          ]);
          expect(progress.passed).toEqual(["write-program"]);
        });

        it("takes no Check again when the last run is not unconfirmed", () => {
          const { inputs } = walk(calling(), [
            start,
            press(2000),
            ended(3000, REFUSED),
            recheck(4000),
          ]);
          expect(inputs).toHaveLength(1);
        });

        it("sends anew on a press of the act card", () => {
          const { inputs } = walk(calling(), [
            start,
            press(2000),
            ended(3000, UNCONFIRMED),
            press(4000),
          ]);
          expect(inputs[1]).not.toHaveProperty("recheck");
        });

        it("checks again as often as devnet stays slow", () => {
          const { inputs } = walk(calling(), [
            start,
            press(2000),
            ended(3000, UNCONFIRMED),
            recheck(4000),
            ended(5000, UNCONFIRMED),
            recheck(6000),
          ]);
          expect(inputs).toHaveLength(3);
          expect(inputs[2].recheck).toEqual(UNREAD);
        });

        it("has nothing to explain, so Explain leaves Check again open", () => {
          const explain: Action = {
            type: "explain",
            beatId: "s1.grow",
            at: 4000,
          };
          const { progress, inputs } = walk(calling(), [
            start,
            press(2000),
            ended(3000, UNCONFIRMED),
            explain,
            recheck(5000),
          ]);
          expect(progress.runs["s1.grow"][0]).not.toHaveProperty("explainedAt");
          expect(inputs[1].recheck).toEqual(UNREAD);
        });
      });

      it("asks the run to read the account its act names", () => {
        const c = growing({ label: "Grow until out" });
        const grow = c.definition.steps[0].beats[0];
        if (grow.kind !== "act") throw new Error("the card moved");
        grow.account = { kind: "memory", name: "map", capacity: 40960 };
        const { inputs } = walk(c, [start, press(2000)]);
        expect(inputs[0].account).toBe("map");
      });

      it("remembers what a landed call wrote to, and sends it with later calls", () => {
        const { progress, inputs } = walk(
          growing({ label: "Grow until out" }),
          [
            start,
            press(2000),
            ended(
              3000,
              callOk("made", {
                wrote: [
                  { name: "map", address: "Old" },
                  { name: "map", address: "Map1" },
                ],
              })
            ),
            press(4000),
          ]
        );
        expect(progress.accounts).toEqual({ map: "Map1" });
        expect(inputs[0].call).not.toHaveProperty("accounts");
        expect(inputs[1].call?.accounts).toEqual({ map: "Map1" });
      });

      it("goes no further than a failed press on a refusal the goal does not name", () => {
        const { progress } = walk(
          growing({ label: "Grow to 40 KB", until: "is 40960 bytes" }),
          [start, press(2000), ended(3000, REFUSED)]
        );
        expect(progress.runs["s1.grow"].map((r) => r.status)).toEqual([
          "failed",
        ]);
        expect(progress.beats["s1.paint"]).toBeUndefined();
        expect(progress.passed).toEqual([]);
      });

      it("takes no press once the step passed another way", () => {
        const { inputs } = walk(growing({ label: "Grow until out" }), [
          start,
          { type: "passed", via: "call_panel", result: REFUSED, at: 1500 },
          press(2000),
        ]);
        expect(inputs).toEqual([]);
      });

      it("keeps the remembered accounts through a step's Reset", () => {
        const { progress } = walk(growing({ label: "Grow until out" }), [
          start,
          press(2000),
          ended(
            3000,
            callOk("made", { wrote: [{ name: "map", address: "Map1" }] })
          ),
          { type: "restartStep", at: 4000 },
        ]);
        expect(progress.runs["s1.grow"]).toBeUndefined();
        expect(progress.accounts).toEqual({ map: "Map1" });
      });

      it("remembers nothing from a press that failed", () => {
        const { progress } = walk(growing({ label: "Grow until out" }), [
          start,
          press(2000),
          ended(3000, REFUSED),
        ]);
        expect(progress.accounts).toEqual({});
      });

      it("remembers a Call panel call that passed nothing, and Start over clears it", () => {
        const c = growing({ label: "Grow until out" });
        const panel: Action = {
          type: "passed",
          via: "call_panel",
          result: callOk("made", { wrote: [{ name: "map", address: "Map1" }] }),
          at: 3000,
        };
        expect(walk(c, [start, panel]).progress).toMatchObject({
          accounts: { map: "Map1" },
          passed: [],
        });
        expect(
          walk(c, [start, panel, { type: "startOver", at: 4000 }]).progress
            .accounts
        ).toEqual({});
      });
    });

    describe("start", () => {
      it("enters step 1, posts up to the first question and emits tutorial_started", () => {
        const { progress, effects } = play([start]);
        expect(progress.startedAt).toBe(1000);
        expect(progress.cursor).toEqual({
          kind: "step",
          stepId: "write-program",
          beat: 3,
          fail: false,
        });
        expect(progress.times["write-program"]).toEqual({
          from: 1000,
          to: null,
        });
        expect(progress.beats["s1.boil"]).toEqual({ kind: "said", at: 1000 });
        expect(progress.beats["s1.what"]).toEqual({
          kind: "said",
          at: 1000 + TICK_MS,
        });
        expect(progress.beats["s1.q1"]).toEqual({
          kind: "open",
          at: 1000 + 2 * TICK_MS,
          wrong: [],
        });
        expect(effects).toEqual([
          {
            kind: "restore",
            files: hello.steps[0].start,
            remove: ["client/client.ts"],
          },
          {
            kind: "event",
            name: "tutorial_started",
            params: { tutorial: "hello-anchor" },
          },
          {
            kind: "write",
            beatId: "s1.boil",
            file: "src/lib.rs",
            block:
              'use anchor_lang::prelude::*;\n\ndeclare_id!("11111111111111111111111111111111");',
            key: null,
            at: 1000,
          },
        ]);
      });

      it("is a no-op once started", () => {
        const once = play([start]).state;
        expect(reduce(ctx(), once, start).state).toBe(once);
      });

      it("carries a write's own ref and start into its effect", () => {
        const d = JSON.parse(JSON.stringify(hello)) as TutorialDefinition;
        const boil = d.steps[0].beats[0];
        if (boil.kind !== "write" || "create" in boil.writes) {
          throw new Error("Hello Anchor opens on a block write");
        }
        boil.writes.ref = boil.writes.block;
        boil.writes.start = "";
        const { effects } = reduce(
          {
            definition: d,
            slug: "hello-anchor",
            judge: (_goal, result) => result.ok,
          },
          INITIAL_ENGINE_STATE,
          start
        );
        expect(effects.find((e) => e.kind === "write")).toMatchObject({
          beatId: "s1.boil",
          ref: boil.writes.block,
          start: "",
        });
      });

      it("carries a question's own ref and start into the write its right pick queues", () => {
        const d = JSON.parse(JSON.stringify(hello)) as TutorialDefinition;
        const q1 = d.steps[0].beats[2];
        if (q1.kind !== "ask" || !q1.writes) {
          throw new Error("Hello Anchor's first question writes a block");
        }
        q1.writes.ref = q1.writes.block;
        q1.writes.start = "";
        const c: EngineContext = {
          definition: d,
          slug: "hello-anchor",
          judge: (_goal, result) => result.ok,
        };
        const state = reduce(c, INITIAL_ENGINE_STATE, start).state;
        const r = reduce(c, state, {
          type: "pick",
          beatId: "s1.q1",
          option: q1.answer,
          at: 9000,
        });
        expect(r.effects.find((e) => e.kind === "write")).toMatchObject({
          beatId: "s1.q1",
          ref: q1.writes.block,
          start: "",
        });
      });

      it("leaves ref and start off a write that has neither", () => {
        const write = play([start]).effects.find((e) => e.kind === "write");
        expect(write).not.toHaveProperty("ref");
        expect(write).not.toHaveProperty("start");
      });
    });

    describe("pick", () => {
      it("records a wrong pick and posts nothing", () => {
        const { progress, effects } = play([
          start,
          { type: "pick", beatId: "s1.q1", option: 0, at: 4000 },
        ]);
        expect(progress.beats["s1.q1"]).toEqual({
          kind: "open",
          at: 1000 + 2 * TICK_MS,
          wrong: [0],
        });
        expect(effects.filter((e) => e.kind === "write")).toHaveLength(1);
      });

      it("resolves a wrong then right pick as 2 attempts, queues the write and reaches the act", () => {
        const { progress, effects } = play([
          start,
          { type: "pick", beatId: "s1.q1", option: 0, at: 4000 },
          rightPick,
        ]);
        expect(progress.beats["s1.q1"]).toEqual({
          kind: "picked",
          at: 5000,
          openedAt: 1000 + 2 * TICK_MS,
          option: 1,
          attempts: 2,
          wrong: [0],
        });
        expect(progress.beats["s1.build"]).toEqual({
          kind: "said",
          at: 5000 + TICK_MS,
        });
        expect(progress.cursor).toEqual({
          kind: "step",
          stepId: "write-program",
          beat: 4,
          fail: false,
        });
        const write = effects.find(
          (e) => e.kind === "write" && e.beatId === "s1.q1"
        );
        expect(write).toMatchObject({
          file: "src/lib.rs",
          key: null,
          at: 5000,
        });
      });

      it("ignores a pick on a resolved question and a repeated wrong one", () => {
        const resolved = play([start, rightPick]).state;
        expect(reduce(ctx(), resolved, rightPick).state).toBe(resolved);
        const wrong = play([
          start,
          { type: "pick", beatId: "s1.q1", option: 0, at: 4000 },
        ]).state;
        expect(
          reduce(ctx(), wrong, {
            type: "pick",
            beatId: "s1.q1",
            option: 0,
            at: 4100,
          }).state
        ).toBe(wrong);
      });
    });

    describe("hint, skip, type it myself", () => {
      it("records the hint once", () => {
        const hinted = play([
          start,
          { type: "hint", beatId: "s1.q1", at: 3000 },
        ]).state;
        expect(hinted.progress.beats["s1.q1"]).toMatchObject({
          kind: "open",
          hintedAt: 3000,
        });
        expect(
          reduce(ctx(), hinted, { type: "hint", beatId: "s1.q1", at: 3500 })
            .state
        ).toBe(hinted);
      });

      it("skips with the write and keeps the hint", () => {
        const { progress, effects } = play([
          start,
          { type: "hint", beatId: "s1.q1", at: 3000 },
          { type: "skip", beatId: "s1.q1", at: 4000 },
        ]);
        expect(progress.beats["s1.q1"]).toEqual({
          kind: "skipped",
          at: 4000,
          openedAt: 1000 + 2 * TICK_MS,
          via: "button",
          wrong: [],
          hintedAt: 3000,
        });
        expect(
          effects.some((e) => e.kind === "write" && e.beatId === "s1.q1")
        ).toBe(true);
      });

      it("a hint the assistant asked for is marked so, through the skip", () => {
        const { progress } = play([
          start,
          { type: "hint", beatId: "s1.q1", at: 3000, byAssistant: true },
          { type: "skip", beatId: "s1.q1", at: 4000 },
        ]);
        expect(progress.beats["s1.q1"]).toMatchObject({
          kind: "skipped",
          hintedAt: 3000,
          hintByAssistant: true,
        });
      });

      it("type it myself focuses the landing in the answer's file", () => {
        const { effects } = play([
          start,
          { type: "typeIt", beatId: "s1.q1", at: 3000 },
        ]);
        expect(effects.at(-1)).toEqual({
          kind: "focus",
          file: "src/lib.rs",
          line: "landing",
        });
      });
    });

    describe("edit", () => {
      const lib = (body: string) =>
        `use anchor_lang::prelude::*;\n\ndeclare_id!("11111111111111111111111111111111");\n\n${body}\n`;

      it("resolves the question as typed when the key line is typed, and queues the fill", () => {
        const { progress, effects } = play([
          start,
          {
            type: "edit",
            file: "src/lib.rs",
            content: lib('msg!("Hello, World!");'),
            at: 6000,
          },
        ]);
        expect(progress.beats["s1.q1"]).toEqual({
          kind: "typed",
          at: 6000,
          openedAt: 1000 + 2 * TICK_MS,
          wrong: [],
        });
        expect(effects.findLast((e) => e.kind === "write")).toMatchObject({
          kind: "write",
          beatId: "s1.q1",
          key: 'msg!("Hello, World!");',
          at: 6000,
        });
      });

      it("resolves as typed with no fill when the whole block is there", () => {
        const ask = hello.steps[0].beats[2] as Ask;
        const { progress, effects } = play([
          start,
          {
            type: "edit",
            file: "src/lib.rs",
            content: lib(ask.writes?.block ?? ""),
            at: 6000,
          },
        ]);
        expect(progress.beats["s1.q1"]).toEqual({
          kind: "typed",
          at: 6000,
          openedAt: 1000 + 2 * TICK_MS,
          wrong: [],
        });
        expect(
          effects.filter((e) => e.kind === "write" && e.beatId === "s1.q1")
        ).toEqual([]);
      });

      it("ignores an edit that holds neither", () => {
        const before = play([start]).state;
        const after = reduce(ctx(), before, {
          type: "edit",
          file: "src/lib.rs",
          content: lib("fn mine() {}"),
          at: 6000,
        });
        expect(after.state).toBe(before);
      });
    });

    describe("tutorial_question_answered", () => {
      const answered = (effects: Effect[]) =>
        effects.filter(
          (e) => e.kind === "event" && e.name === "tutorial_question_answered"
        );
      const event = (result: string, attempts: number, question = "s1.q1") => ({
        kind: "event",
        name: "tutorial_question_answered",
        params: { tutorial: "hello-anchor", question, result, attempts },
      });

      it("counts a right first pick as first_try", () => {
        expect(answered(play([start, rightPick]).effects)).toEqual([
          event("first_try", 1),
        ]);
      });

      it("counts a wrong pick, then the right one, once as retry with 2 attempts", () => {
        const { effects } = play([
          start,
          { type: "pick", beatId: "s1.q1", option: 0, at: 4000 },
          rightPick,
        ]);
        expect(answered(effects)).toEqual([event("retry", 2)]);
      });

      it("counts Skip after a wrong pick as skipped with 2 attempts", () => {
        const { effects } = play([
          start,
          { type: "pick", beatId: "s1.q1", option: 2, at: 4000 },
          { type: "skip", beatId: "s1.q1", at: 4500 },
        ]);
        expect(answered(effects)).toEqual([event("skipped", 2)]);
      });

      it("counts the key line typed by hand as typed", () => {
        const { effects } = play([
          start,
          {
            type: "edit",
            file: "src/lib.rs",
            content: `use anchor_lang::prelude::*;\n\nmsg!("Hello, World!");\n`,
            at: 6000,
          },
        ]);
        expect(answered(effects)).toEqual([event("typed", 1)]);
      });

      it("counts a question passed by the Call panel as call_panel, and one passed by a client run as skipped", () => {
        const called: RunResult = {
          act: "call",
          ok: true,
          seconds: 1,
          signatures: ["x"],
          line: null,
          called: [],
        };
        const panel = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
          { type: "next", at: 9000 },
          { type: "passed", via: "call_panel", result: called, at: 9500 },
        ]).effects;
        expect(answered(panel).at(-1)).toEqual(event("call_panel", 1, "s2.q2"));
        const client = play([
          start,
          { type: "passed", via: "client", result: OK_BUILD, at: 4000 },
        ]).effects;
        expect(answered(client)).toEqual([event("skipped", 1)]);
      });

      it("measures every Call panel call, one that passes nothing too", () => {
        const failed: RunResult = {
          act: "call",
          ok: false,
          seconds: 2,
          message: "no",
          log: "",
        };
        const { effects } = play([
          start,
          { type: "passed", via: "call_panel", result: failed, at: 4000 },
        ]);
        expect(effects).toContainEqual({
          kind: "event",
          name: "tutorial_action_run",
          params: {
            tutorial: expect.any(String),
            step: 1,
            action: "call_panel",
            outcome: "failed",
            seconds: 2,
          },
        });
      });

      it("keeps a landed deploy's IDL in the save, out of the run's record", () => {
        const idlWith = (args: string[]) =>
          ({
            version: "0.1.0",
            name: "hello_anchor",
            instructions: [
              {
                name: "hello",
                accounts: [],
                args: args.map((name) => ({ name, type: "string" })),
              },
            ],
          } as Idl);
        const deploy = (idl: Idl): RunResult => ({
          act: "deploy",
          ok: true,
          seconds: 3,
          programId: "p",
          signature: "s",
          upgraded: false,
          lamports: 1,
          instructions: ["hello"],
          idl,
        });
        const toDeploy: Action[] = [
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
          { type: "next", at: 9000 },
          { type: "skip", beatId: "s2.q2", at: 9100 },
          { type: "act", beatId: "s2.airdrop", at: 9110 },
          {
            type: "ended",
            beatId: "s2.airdrop",
            result: AIRDROPPED,
            at: 9120,
          },
          { type: "act", beatId: "s2.deploy", at: 9200 },
        ];
        const landed = play(
          toDeploy.concat({
            type: "ended",
            beatId: "s2.deploy",
            result: deploy(idlWith([])),
            at: 9900,
          })
        ).state.progress;
        expect(landed.deployed).toEqual({ idl: idlWith([]), added: [] });
        const record = landed.runs["s2.deploy"].at(-1);
        expect(record && "result" in record && "idl" in record.result).toBe(
          false
        );

        const upgraded = reduce(
          ctx(),
          { progress: landed, stage: null },
          {
            type: "ended",
            beatId: "s2.deploy",
            result: deploy(idlWith(["name"])),
            at: 9950,
          }
        );
        // No such run in flight: the engine dropped it, and keeps no IDL
        expect(upgraded.state.progress.deployed).toEqual(landed.deployed);
      });

      it("keeps the IDL of a deploy that ran outside the cards", () => {
        const idlWith = (args: string[]) =>
          ({
            version: "0.1.0",
            name: "hello_anchor",
            instructions: [
              {
                name: "hello",
                accounts: [],
                args: args.map((name) => ({ name, type: "string" })),
              },
            ],
          } as Idl);
        const before = play([start, rightPick]).state;
        const first = reduce(ctx(), before, {
          type: "deployed",
          idl: idlWith([]),
          at: 6000,
        });
        expect(first.state.progress.deployed).toEqual({
          idl: idlWith([]),
          added: [],
        });
        // Nothing else moves: no step passes, no telemetry
        expect(first.effects).toEqual([]);
        expect(first.state.progress.passed).toEqual(before.progress.passed);
        expect(first.state.progress.cursor).toEqual(before.progress.cursor);

        // A terminal redeploy with a new argument: the panel's "New" shows it
        const upgraded = reduce(ctx(), first.state, {
          type: "deployed",
          idl: idlWith(["name"]),
          at: 7000,
        });
        expect(upgraded.state.progress.deployed).toEqual({
          idl: idlWith(["name"]),
          added: ["hello.name"],
        });

        // The same IDL again changes nothing, so nothing is saved
        const again = reduce(ctx(), upgraded.state, {
          type: "deployed",
          idl: idlWith(["name"]),
          at: 8000,
        });
        expect(again.state).toBe(upgraded.state);
      });

      it("shows the program's lines after a call the program could not match", () => {
        const step = hello.steps[2];
        const act = step.beats.find((b) => b.kind === "act");
        if (!act) throw new Error("the Client step has an act");
        const progress = freshProgress();
        progress.cursor = {
          kind: "step",
          stepId: step.id,
          beat: 1,
          fail: false,
        };
        progress.runs = {
          [act.id]: [
            {
              status: "failed",
              at: 2000,
              took: 500,
              result: {
                act: "run",
                ok: false,
                seconds: 1,
                message: "x",
                log: "",
                mismatch: true,
              },
            },
          ],
        };
        const r = reduce(
          ctx(),
          { progress, stage: null },
          { type: "showFix", beatId: act.id, at: 3000 }
        );
        // Not the step's own file, the client: the program is what differs
        expect(r.effects).toEqual([
          {
            kind: "restore",
            files: { "src/lib.rs": step.target["src/lib.rs"] },
            remove: [],
          },
        ]);
        expect(r.state.progress.runs[act.id].at(-1)).toMatchObject({
          fixedAt: 3000,
        });
        // A step with no program to restore restores nothing, not its client
        const withoutProgram = structuredClone(hello);
        delete withoutProgram.steps[2].target["src/lib.rs"];
        const noProgram: EngineContext = {
          definition: withoutProgram,
          slug: "hello-anchor",
          judge: (_goal, result) => result.ok,
        };
        expect(
          reduce(
            noProgram,
            { progress, stage: null },
            { type: "showFix", beatId: act.id, at: 3000 }
          ).effects
        ).toEqual([]);
      });

      describe("a tutorial that ships its IDL", () => {
        // What `yarn tutorial:idl` writes for Hello Anchor's first program
        const SHIPPED = JSON.stringify({
          address: "11111111111111111111111111111111",
          metadata: { name: "hello_anchor", version: "0.1.0", spec: "0.1.0" },
          instructions: [
            {
              name: "hello",
              discriminator: [149, 118, 59, 220, 196, 127, 161, 179],
              accounts: [],
              args: [],
            },
          ],
        });
        const shipping = (): EngineContext => {
          const definition = structuredClone(hello);
          definition.steps[0].idl = SHIPPED;
          return {
            definition,
            slug: "hello-anchor",
            judge: (_goal, result) => result.ok && result.act !== "airdrop",
          };
        };
        const playIn = (c: EngineContext, actions: Action[]) =>
          actions.reduce(
            (st, a) => reduce(c, st, a).state,
            INITIAL_ENGINE_STATE
          );
        const BARE_BUILD: RunResult = {
          act: "build",
          ok: true,
          seconds: 1.6,
          instructions: [],
        };
        const toDeploy: Action[] = [
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: BARE_BUILD, at: 8600 },
          { type: "next", at: 9000 },
          { type: "skip", beatId: "s2.q2", at: 9100 },
          { type: "act", beatId: "s2.airdrop", at: 9110 },
          {
            type: "ended",
            beatId: "s2.airdrop",
            result: AIRDROPPED,
            at: 9120,
          },
          { type: "act", beatId: "s2.deploy", at: 9200 },
        ];
        const landedDeploy = (idl?: Idl): Action => {
          const result: RunResult = {
            act: "deploy",
            ok: true,
            seconds: 3,
            programId: "p",
            signature: "s",
            upgraded: false,
            lamports: 1,
            instructions: [],
          };
          if (idl) result.idl = idl;
          return { type: "ended", beatId: "s2.deploy", result, at: 9900 };
        };
        const names = (p: ConversationProgress) =>
          p.deployed?.idl.instructions.map((ix) => ix.name);

        it("never lends a build its instructions: the build goal reads the learner's", () => {
          const p = playIn(shipping(), toDeploy).progress;
          const record = p.runs["s1.build"].at(-1);
          expect(
            record && "result" in record && "instructions" in record.result
              ? record.result.instructions
              : null
          ).toEqual([]);
        });

        // Step 4's program takes a name: Hello Anchor's second shipped IDL
        const SHIPPED_NAME = SHIPPED.replace(
          '"args":[]',
          '"args":[{"name":"name","type":"string"}]'
        );
        const twoShipped = (): EngineContext => {
          const definition = structuredClone(hello);
          definition.steps[0].idl = SHIPPED;
          definition.steps[3].idl = SHIPPED_NAME;
          return {
            definition,
            slug: "hello-anchor",
            judge: (_goal, result) => result.ok && result.act !== "airdrop",
          };
        };
        const at = (index: number): EngineState => {
          const progress = freshProgress();
          progress.cursor = {
            kind: "step",
            stepId: hello.steps[index].id,
            beat: 0,
            fail: false,
          };
          return { progress, stage: null };
        };

        it("upgrades from one shipped IDL to the next, naming what it added", () => {
          const c = twoShipped();
          const first = reduce(c, at(1), { type: "deployed", at: 6000 });
          expect(names(first.state.progress)).toEqual(["hello"]);
          expect(first.state.progress.deployed?.added).toEqual([]);
          const moved = structuredClone(first.state);
          moved.progress.cursor = at(3).progress.cursor;
          const upgraded = reduce(c, moved, { type: "deployed", at: 7000 });
          expect(
            upgraded.state.progress.deployed?.idl.instructions[0].args
          ).toEqual([{ name: "name", type: "string" }]);
          expect(upgraded.state.progress.deployed?.added).toEqual([
            "hello.name",
          ]);
          // The same deploy again saves nothing
          const again = reduce(c, upgraded.state, {
            type: "deployed",
            at: 8000,
          });
          expect(again.state).toBe(upgraded.state);
        });

        it("keeps the IDL of the step that deployed, when the deploy is recognised later", () => {
          const deployResult: RunResult = {
            act: "deploy",
            ok: true,
            seconds: 3,
            programId: "p",
            signature: "s",
            upgraded: false,
            lamports: 1,
            instructions: [],
          };
          // s2.deploy is step 2's act; the learner is on step 4 by now
          const { idl } = takeDeployedIdl(twoShipped(), at(3), {
            type: "recognised",
            beatId: "s2.deploy",
            result: deployResult,
            at: 9000,
          });
          expect(idl?.instructions[0].args).toEqual([]);
        });

        it("keeps it on a landed deploy, whatever IDL the build returned", () => {
          const noIdl = playIn(shipping(), toDeploy.concat(landedDeploy()));
          expect(names(noIdl.progress)).toEqual(["hello"]);
          const built = playIn(
            shipping(),
            toDeploy.concat(
              landedDeploy({
                version: "0.1.0",
                name: "other",
                instructions: [{ name: "bye", accounts: [], args: [] }],
              } as Idl)
            )
          );
          expect(names(built.progress)).toEqual(["hello"]);
        });

        it("keeps it for a terminal deploy that brought no IDL", () => {
          const before = playIn(shipping(), [start, rightPick]);
          const after = reduce(shipping(), before, {
            type: "deployed",
            at: 6000,
          });
          expect(names(after.state.progress)).toEqual(["hello"]);
          // With nothing shipped and nothing built, nothing to keep
          const bare = playIn(ctx(), [start, rightPick]);
          expect(
            reduce(ctx(), bare, { type: "deployed", at: 6000 }).state
          ).toBe(bare);
        });
      });

      it("counts a question once, whatever comes after it resolved", () => {
        const { effects } = play([
          start,
          rightPick,
          { type: "pick", beatId: "s1.q1", option: 1, at: 5100 },
          { type: "skip", beatId: "s1.q1", at: 5200 },
        ]);
        expect(answered(effects)).toEqual([event("first_try", 1)]);
      });

      it("caps attempts at 3 and sends nothing for a wrong pick or a hint", () => {
        const { effects } = play([
          start,
          { type: "hint", beatId: "s1.q1", at: 3000 },
          { type: "pick", beatId: "s1.q1", option: 0, at: 4000 },
          { type: "pick", beatId: "s1.q1", option: 2, at: 4500 },
        ]);
        expect(answered(effects)).toEqual([]);
        const after = play([
          start,
          { type: "pick", beatId: "s1.q1", option: 0, at: 4000 },
          { type: "pick", beatId: "s1.q1", option: 2, at: 4500 },
          { type: "skip", beatId: "s1.q1", at: 5000 },
        ]).effects;
        expect(answered(after)).toEqual([event("skipped", 3)]);
      });
    });

    describe("written", () => {
      it("turns a write beat into written and attaches an answer's lines", () => {
        const { progress } = play([
          start,
          {
            type: "written",
            beatId: "s1.boil",
            wrote: { file: "src/lib.rs", lines: [1, 2, 3] },
            at: 1000,
          },
          rightPick,
          {
            type: "written",
            beatId: "s1.q1",
            wrote: {
              file: "src/lib.rs",
              lines: [5, 6, 7, 8, 9, 10, 11, 12, 13],
            },
            at: 5000,
          },
        ]);
        expect(progress.beats["s1.boil"]).toEqual({
          kind: "written",
          at: 1000,
          wrote: { file: "src/lib.rs", lines: [1, 2, 3] },
        });
        expect(progress.beats["s1.q1"]).toMatchObject({
          kind: "picked",
          wrote: { file: "src/lib.rs", lines: [5, 6, 7, 8, 9, 10, 11, 12, 13] },
        });
      });
    });

    describe("writeFailed", () => {
      it("marks the resolution, and a later write clears it", () => {
        const failedWrite = play([
          start,
          { type: "writeFailed", beatId: "s1.boil", at: 1000 },
          rightPick,
          { type: "writeFailed", beatId: "s1.q1", at: 5000 },
        ]).state;
        expect(failedWrite.progress.beats["s1.boil"]).toEqual({
          kind: "said",
          at: 1000,
          writeFailed: true,
        });
        expect(failedWrite.progress.beats["s1.q1"]).toMatchObject({
          kind: "picked",
          writeFailed: true,
        });
        const landed = reduce(ctx(), failedWrite, {
          type: "written",
          beatId: "s1.q1",
          wrote: { file: "src/lib.rs", lines: [5] },
          at: 5100,
        }).state;
        expect(landed.progress.beats["s1.q1"]).not.toHaveProperty(
          "writeFailed"
        );
        expect(landed.progress.beats["s1.q1"]).toMatchObject({
          wrote: { lines: [5] },
        });
        // An open question or a landed write has nothing to mark
        const open = play([start]).state;
        expect(
          reduce(ctx(), open, { type: "writeFailed", beatId: "s1.q1", at: 2 })
            .state
        ).toBe(open);
      });
    });

    describe("act and ended", () => {
      it("starts the run and queues it, once", () => {
        const { progress, effects, state } = play([
          start,
          rightPick,
          build(7000),
        ]);
        expect(progress.runs["s1.build"]).toEqual([
          { status: "started", at: 7000 },
        ]);
        expect(effects.at(-1)).toEqual({
          kind: "run",
          beatId: "s1.build",
          act: "build",
          input: {
            beatId: "s1.build",
            failsWith: "cannot find type `Hello` in this scope",
          },
          startedAt: 7000,
        });
        expect(reduce(ctx(), state, build(7100)).state).toBe(state);
      });

      it("refuses an act that the lesson has not reached", () => {
        const before = play([start]).state;
        expect(reduce(ctx(), before, build(7000)).state).toBe(before);
      });

      it("shows the stage while running and clears it when the run ends", () => {
        const midRun = play([
          start,
          rightPick,
          build(7000),
          {
            type: "stage",
            beatId: "s1.build",
            label: "Building",
            index: 1,
            count: 1,
            detail: "half way",
            at: 7100,
          },
        ]).state;
        expect(midRun.stage).toEqual({
          beatId: "s1.build",
          label: "Building",
          index: 1,
          count: 1,
          detail: "half way",
        });
        const ended = reduce(ctx(), midRun, {
          type: "ended",
          beatId: "s1.build",
          result: OK_BUILD,
          at: 8600,
        });
        expect(ended.state.stage).toBeNull();
        expect(ended.state.progress.runs["s1.build"]).toEqual([
          { status: "ok", at: 7000, took: 1600, result: OK_BUILD },
        ]);
      });

      it("passes the step on an ok result the judge accepts, with the win's time", () => {
        const { progress } = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
        ]);
        expect(progress.passed).toEqual(["write-program"]);
        expect(progress.times["write-program"]).toEqual({
          from: 1000,
          to: 8600,
          via: "chat",
        });
      });

      it("emits tutorial_action_run when a run ends, its outcome from the result", () => {
        const actionRun = (effects: Effect[]) =>
          effects.filter(
            (e) => e.kind === "event" && e.name === "tutorial_action_run"
          );
        const FAILED_TEST_BUILD: RunResult = {
          act: "build",
          ok: false,
          seconds: 1,
          reason: "compiler",
          error: null,
          log: "down",
        };
        const { effects } = play([
          start,
          rightPick,
          build(7000),
          {
            type: "ended",
            beatId: "s1.build",
            result: FAILED_TEST_BUILD,
            at: 8000,
          },
          build(9000),
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 10600 },
          // A stale answer for a run no longer in flight records nothing
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 11000 },
        ]);
        expect(actionRun(effects)).toEqual([
          {
            kind: "event",
            name: "tutorial_action_run",
            params: {
              tutorial: "hello-anchor",
              step: 1,
              action: "build",
              outcome: "failed",
              seconds: 1,
            },
          },
          {
            kind: "event",
            name: "tutorial_action_run",
            params: {
              tutorial: "hello-anchor",
              step: 1,
              action: "build",
              outcome: "ok",
              seconds: 2,
            },
          },
        ]);
      });

      it("names a deploy's outcome by its reason", () => {
        expect(
          outcomeOf({
            act: "buildDeploy",
            ok: false,
            seconds: 4,
            reason: "no_funds",
            message: "429",
            balance: 0,
            cost: 1,
            address: "w",
          })
        ).toBe("no_funds");
        expect(
          outcomeOf({
            act: "deploy",
            ok: false,
            seconds: 0,
            reason: "no_wallet",
            message: "No wallet",
          })
        ).toBe("no_wallet");
        expect(outcomeOf(DEPLOYED)).toBe("ok");
      });

      it("names an airdrop's outcome by its reason, as a deploy's", () => {
        expect(
          outcomeOf({
            act: "airdrop",
            ok: false,
            seconds: 3,
            reason: "no_funds",
            message: "429",
            balance: 0,
            cost: 1,
            address: "w",
          })
        ).toBe("no_funds");
        expect(outcomeOf(AIRDROPPED)).toBe("ok");
      });

      it("emits tutorial_action_run with the airdrop action when the airdrop ends", () => {
        const { effects } = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
          { type: "next", at: 9000 },
          { type: "skip", beatId: "s2.q2", at: 9500 },
          { type: "act", beatId: "s2.airdrop", at: 9510 },
          {
            type: "ended",
            beatId: "s2.airdrop",
            result: AIRDROPPED,
            at: 9520,
          },
        ]);
        expect(
          effects.filter(
            (e) => e.kind === "event" && e.name === "tutorial_action_run"
          )
        ).toContainEqual({
          kind: "event",
          name: "tutorial_action_run",
          params: {
            tutorial: "hello-anchor",
            step: 2,
            action: "airdrop",
            outcome: "ok",
            seconds: 0,
          },
        });
      });

      it("names a run's or call's outcome by its reason, else failed", () => {
        expect(
          outcomeOf({
            act: "call",
            ok: false,
            seconds: 1,
            message: "short",
            log: "",
            reason: "no_funds",
            funding: { balance: 0, cost: 500_000_000, address: "w" },
          })
        ).toBe("no_funds");
        expect(
          outcomeOf({
            act: "run",
            ok: false,
            seconds: 0,
            message: "No wallet",
            log: "",
            reason: "no_wallet",
          })
        ).toBe("no_wallet");
        expect(
          outcomeOf({
            act: "run",
            ok: false,
            seconds: 2,
            message: "x",
            log: "",
          })
        ).toBe("failed");
        expect(
          outcomeOf({
            act: "run",
            ok: false,
            seconds: 2,
            message: "client.ts sent no transaction. See the terminal.",
            log: "",
            reason: "no_transaction",
          })
        ).toBe("failed");
      });

      it("measures acts a reload interrupted, and nothing else", () => {
        const r = reduce(ctx(), INITIAL_ENGINE_STATE, {
          type: "interrupted",
          beatIds: ["s2.deploy", "s1.q1", "gone"],
          at: 1,
        });
        expect(r.state).toBe(INITIAL_ENGINE_STATE);
        expect(r.effects).toEqual([
          {
            kind: "event",
            name: "tutorial_action_run",
            params: {
              tutorial: "hello-anchor",
              step: 2,
              action: "deploy",
              outcome: "interrupted",
              seconds: 0,
            },
          },
        ]);
      });

      it("emits tutorial_step_passed once per step, with how and how long", () => {
        const stepPassed = (effects: Effect[]) =>
          effects.filter(
            (e) => e.kind === "event" && e.name === "tutorial_step_passed"
          );
        const CALLED: RunResult = {
          act: "call",
          ok: true,
          seconds: 1,
          signatures: ["x"],
          line: null,
          called: [],
        };
        const { effects } = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
          { type: "next", at: 9000 },
          { type: "passed", via: "call_panel", result: CALLED, at: 12000 },
          // On step 2's win: the step has passed, so nothing more fires
          { type: "passed", via: "call_panel", result: CALLED, at: 12500 },
          { type: "next", at: 13000 },
          { type: "passed", via: "client", result: CALLED, at: 20400 },
        ]);
        expect(stepPassed(effects)).toEqual([
          {
            kind: "event",
            name: "tutorial_step_passed",
            params: {
              tutorial: "hello-anchor",
              step: 1,
              via: "chat",
              seconds: 8,
            },
          },
          {
            kind: "event",
            name: "tutorial_step_passed",
            params: {
              tutorial: "hello-anchor",
              step: 2,
              via: "call_panel",
              seconds: 3,
            },
          },
          {
            kind: "event",
            name: "tutorial_step_passed",
            params: {
              tutorial: "hello-anchor",
              step: 3,
              via: "client",
              seconds: 7,
            },
          },
        ]);
      });

      it("drops a result whose start is not the run's", () => {
        const before = play([start, rightPick, build(7000)]).state;
        const stale = reduce(ctx(), before, {
          type: "ended",
          beatId: "s1.build",
          startedAt: 6000,
          result: OK_BUILD,
          at: 8600,
        });
        expect(stale.state).toBe(before);
        const staleStage = reduce(ctx(), before, {
          type: "stage",
          beatId: "s1.build",
          startedAt: 6000,
          label: "Building",
          index: 1,
          count: 1,
          at: 7100,
        });
        expect(staleStage.state).toBe(before);
        const own = reduce(ctx(), before, {
          type: "ended",
          beatId: "s1.build",
          startedAt: 7000,
          result: OK_BUILD,
          at: 8600,
        });
        expect(own.state.progress.passed).toEqual(["write-program"]);
      });

      it("a run that outlived its step records its result and moves nothing on", () => {
        const left = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
          { type: "next", at: 9000 },
          { type: "skip", beatId: "s2.q2", at: 9500 },
          { type: "act", beatId: "s2.airdrop", at: 9510 },
          {
            type: "ended",
            beatId: "s2.airdrop",
            result: AIRDROPPED,
            at: 9520,
          },
          { type: "act", beatId: "s2.deploy", at: 10000 },
          {
            type: "passed",
            via: "call_panel",
            result: {
              act: "call",
              ok: true,
              seconds: 1,
              signatures: [],
              line: null,
              called: [],
            },
            at: 10500,
          },
          { type: "next", at: 11000 },
        ]).state;
        expect(left.progress.beats["s3.q3"]).toMatchObject({ kind: "open" });
        const r = reduce(ctx(), left, {
          type: "ended",
          beatId: "s2.deploy",
          result: DEPLOYED,
          at: 12000,
        });
        expect(r.state.progress.runs["s2.deploy"]).toMatchObject([
          { status: "ok" },
        ]);
        expect(r.state.progress.beats["s3.q3"]).toMatchObject({ kind: "open" });
        expect(r.state.progress.beats["s3.run"]).toBeUndefined();
        // Measured, and nothing else: no turn posts
        expect(r.effects).toEqual([
          expect.objectContaining({ name: "tutorial_action_run" }),
        ]);
      });

      describe("recognised", () => {
        /** Step 2's deploy pressed, then a reload: the run reads interrupted */
        const interrupted = (): EngineState => {
          const midRun = play([
            start,
            rightPick,
            build(7000),
            { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
            { type: "next", at: 9000 },
            { type: "skip", beatId: "s2.q2", at: 9500 },
            { type: "act", beatId: "s2.airdrop", at: 9510 },
            {
              type: "ended",
              beatId: "s2.airdrop",
              result: AIRDROPPED,
              at: 9520,
            },
            { type: "act", beatId: "s2.deploy", at: 10000 },
          ]).state;
          return {
            progress: {
              version: midRun.progress.version,
              passed: midRun.progress.passed,
              finishedAt: midRun.progress.finishedAt,
              startedAt: midRun.progress.startedAt,
              restartedAt: midRun.progress.restartedAt,
              said: midRun.progress.said,
              proposals: midRun.progress.proposals,
              accounts: midRun.progress.accounts,
              cursor: midRun.progress.cursor,
              beats: midRun.progress.beats,
              times: midRun.progress.times,
              runs: Object.fromEntries(
                Object.entries(midRun.progress.runs).map(([id, rs]) => [
                  id,
                  rs.map((r) =>
                    r.status === "started"
                      ? { status: "interrupted" as const, at: r.at }
                      : r
                  ),
                ])
              ),
            },
            stage: null,
          };
        };

        it("posts a deploy found on the chain as if it had ended", () => {
          const r = reduce(ctx(), interrupted(), {
            type: "recognised",
            beatId: "s2.deploy",
            result: DEPLOYED,
            at: 30000,
          });
          expect(r.state.progress.runs["s2.deploy"]).toMatchObject([
            { status: "ok", at: 10000, result: DEPLOYED },
          ]);
          expect(r.state.progress.passed).toContain("deploy");
          expect(r.effects).toContainEqual(
            expect.objectContaining({
              name: "tutorial_action_run",
              params: expect.objectContaining({
                action: "deploy",
                outcome: "ok",
                step: 2,
              }),
            })
          );
        });

        it("leaves a run that is not interrupted alone", () => {
          const state = interrupted();
          const once = reduce(ctx(), state, {
            type: "recognised",
            beatId: "s2.deploy",
            result: DEPLOYED,
            at: 30000,
          }).state;
          const twice = reduce(ctx(), once, {
            type: "recognised",
            beatId: "s2.deploy",
            result: DEPLOYED,
            at: 31000,
          });
          expect(twice.state).toBe(once);
          expect(twice.effects).toEqual([]);
        });
      });

      it("an ok result the judge refuses leaves the act to run again", () => {
        const strict: EngineContext = {
          definition: hello,
          slug: "hello-anchor",
          judge: (goal, result) =>
            result.ok && goal.kind === result.act && result.act !== "build",
        };
        let state = INITIAL_ENGINE_STATE;
        for (const a of [start, rightPick, build(7000)])
          state = reduce(strict, state, a).state;
        const refused = reduce(strict, state, {
          type: "ended",
          beatId: "s1.build",
          result: OK_BUILD,
          at: 8600,
        }).state;
        expect(refused.progress.passed).toEqual([]);
        const again = reduce(strict, refused, build(9000));
        expect(again.state.progress.runs["s1.build"]).toMatchObject([
          { status: "ok" },
          { status: "started", at: 9000 },
        ]);
      });

      it("a run again of an act the flow went past posts nothing, even when ok", () => {
        // A step whose act comes before its question: refused twice, the
        // second result must not post the beats past the open question
        const s1 = hello.steps[0];
        const definition: TutorialDefinition = {
          version: hello.version,
          name: hello.name,
          description: hello.description,
          authors: hello.authors,
          level: hello.level,
          framework: hello.framework,
          languages: hello.languages,
          thumbnail: hello.thumbnail,
          minutes: hello.minutes,
          intro: hello.intro,
          steps: [
            {
              id: s1.id,
              title: s1.title,
              short: s1.short,
              objective: s1.objective,
              learned: s1.learned,
              file: s1.file,
              start: s1.start,
              target: s1.target,
              beats: [s1.beats[3], s1.beats[1], s1.beats[2]],
              goal: s1.goal,
              win: s1.win,
              explain: s1.explain,
            },
          ],
          finish: hello.finish,
        };
        const refusing: EngineContext = {
          definition,
          slug: "x",
          judge: () => false,
        };
        let state = INITIAL_ENGINE_STATE;
        const run = (a: Action) => (state = reduce(refusing, state, a).state);
        run(start);
        run(build(2000));
        run({ type: "ended", beatId: "s1.build", result: OK_BUILD, at: 3000 });
        // The flow went on to the question
        expect(state.progress.beats["s1.q1"]).toMatchObject({ kind: "open" });
        const cursorBefore = state.progress.cursor;
        run(build(4000));
        const r = reduce(refusing, state, {
          type: "ended",
          beatId: "s1.build",
          result: OK_BUILD,
          at: 5000,
        });
        expect(r.state.progress.cursor).toEqual(cursorBefore);
        expect(r.state.progress.beats["s1.q1"]).toMatchObject({ kind: "open" });
        // Measured, and nothing else: no turn posts
        expect(r.effects).toEqual([
          expect.objectContaining({ name: "tutorial_action_run" }),
        ]);
      });

      it("drops a result for a run that is not in flight", () => {
        const before = play([start, rightPick]).state;
        const r = reduce(ctx(), before, {
          type: "ended",
          beatId: "s1.build",
          result: OK_BUILD,
          at: 8600,
        });
        expect(r.state).toBe(before);
      });

      it("records a failed build and passes nothing", () => {
        const { progress } = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: FAILED_BUILD, at: 8200 },
        ]);
        expect(progress.passed).toEqual([]);
        expect(progress.runs["s1.build"]).toMatchObject([
          { status: "failed", took: 1200 },
        ]);
      });

      it("hands a run the step goal's log pattern, so the runner picks the card's line", () => {
        const s3 = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
          { type: "next", at: 9000 },
          { type: "skip", beatId: "s2.q2", at: 9500 },
          { type: "act", beatId: "s2.airdrop", at: 9510 },
          {
            type: "ended",
            beatId: "s2.airdrop",
            result: AIRDROPPED,
            at: 9520,
          },
          { type: "act", beatId: "s2.deploy", at: 10000 },
          { type: "ended", beatId: "s2.deploy", result: DEPLOYED, at: 12000 },
          { type: "next", at: 13000 },
          { type: "skip", beatId: "s3.q3", at: 13500 },
        ]);
        const { effects } = reduce(ctx(), s3.state, {
          type: "act",
          beatId: "s3.run",
          at: 14000,
        });
        expect(effects).toEqual([
          expect.objectContaining({
            kind: "run",
            input: { beatId: "s3.run", log: "Hello, World!" },
          }),
        ]);
      });

      it("a failed transaction on step 3 passes nothing, and the act stays live", () => {
        const s3 = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
          { type: "next", at: 9000 },
          { type: "skip", beatId: "s2.q2", at: 9500 },
          { type: "act", beatId: "s2.airdrop", at: 9510 },
          {
            type: "ended",
            beatId: "s2.airdrop",
            result: AIRDROPPED,
            at: 9520,
          },
          { type: "act", beatId: "s2.deploy", at: 10000 },
          { type: "ended", beatId: "s2.deploy", result: DEPLOYED, at: 12000 },
          { type: "next", at: 13000 },
          { type: "skip", beatId: "s3.q3", at: 13500 },
          { type: "act", beatId: "s3.run", at: 14000 },
        ]);
        const strict: EngineContext = {
          definition: hello,
          slug: "hello-anchor",
          judge: judgeGoal,
        };
        const { state } = reduce(strict, s3.state, {
          type: "ended",
          beatId: "s3.run",
          result: {
            act: "run",
            ok: false,
            seconds: 1,
            message: "Simulation failed",
            log: "Program log: Instruction: Hello",
            refused: { instruction: "hello", error: null },
          },
          at: 15000,
        });
        expect(state.progress.passed).not.toContain("call-client");
        expect(state.progress.runs["s3.run"]).toMatchObject([
          { status: "failed" },
        ]);
        // The act runs again
        expect(
          reduce(strict, state, { type: "act", beatId: "s3.run", at: 16000 })
            .effects
        ).toEqual([expect.objectContaining({ kind: "run" })]);
      });

      it("flows on after an ok act that is not the goal", () => {
        // Step 4: build and deploy, then the call
        const s4 = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
          { type: "next", at: 9000 },
          { type: "skip", beatId: "s2.q2", at: 9500 },
          { type: "act", beatId: "s2.airdrop", at: 9510 },
          {
            type: "ended",
            beatId: "s2.airdrop",
            result: AIRDROPPED,
            at: 9520,
          },
          { type: "act", beatId: "s2.deploy", at: 10000 },
          {
            type: "ended",
            beatId: "s2.deploy",
            result: DEPLOYED,
            at: 12000,
          },
          { type: "next", at: 13000 },
          { type: "skip", beatId: "s3.q3", at: 13500 },
          { type: "act", beatId: "s3.run", at: 14000 },
          {
            type: "ended",
            beatId: "s3.run",
            result: {
              act: "run",
              ok: true,
              seconds: 1,
              signatures: ["x"],
              line: "Program log: Hello, World!",
              called: [],
            },
            at: 15000,
          },
          { type: "next", at: 16000 },
          { type: "skip", beatId: "s4.q4", at: 16500 },
          { type: "act", beatId: "s4.airdrop", at: 16600 },
          {
            type: "ended",
            beatId: "s4.airdrop",
            result: AIRDROPPED,
            at: 16700,
          },
          { type: "act", beatId: "s4.ship", at: 17000 },
        ]);
        expect(s4.progress.times["call-client"]).toMatchObject({
          via: "client",
        });
        // The step's goal is the call, so the real judge refuses the deploy
        // and the lesson flows on to the call
        const strict: EngineContext = {
          definition: hello,
          slug: "hello-anchor",
          judge: judgeGoal,
        };
        const flowed = reduce(strict, s4.state, {
          type: "ended",
          beatId: "s4.ship",
          result: {
            act: "buildDeploy",
            ok: true,
            seconds: 2,
            programId: "p",
            signature: "t",
            upgraded: true,
            lamports: 1,
            instructions: ["hello"],
          },
          at: 19000,
        });
        expect(flowed.state.progress.passed).not.toContain("greet-by-name");
        expect(flowed.state.progress.beats["s4.call"]).toEqual({
          kind: "said",
          at: 19000 + TICK_MS,
        });
        expect(flowed.state.progress.cursor).toEqual({
          kind: "step",
          stepId: "greet-by-name",
          beat: 5,
          fail: false,
        });
        expect(
          flowed.effects.filter(
            (e) => e.kind === "event" && e.name === "tutorial_step_passed"
          )
        ).toEqual([]);

        // A call the deployed program decodes with no `name` (before the
        // upgrade) logs a line step 4's pattern also matches, and passes nothing
        const call = (
          state: EngineState,
          at: number,
          args: Record<string, string>
        ) => {
          const acted = reduce(strict, state, {
            type: "act",
            beatId: "s4.call",
            args,
            at,
          }).state;
          return reduce(strict, acted, {
            type: "ended",
            beatId: "s4.call",
            result: {
              act: "call",
              ok: true,
              seconds: 1,
              signatures: ["x"],
              line: `Program log: Hello, ${args.name ?? "World"}!`,
              called: [{ instruction: "hello", args }],
            },
            at: at + 1000,
          });
        };
        const early = call(flowed.state, 20000, {});
        expect(early.state.progress.passed).not.toContain("greet-by-name");
        // Measured, and nothing else: no turn posts
        expect(early.effects).toEqual([
          expect.objectContaining({ name: "tutorial_action_run" }),
        ]);

        const named = call(early.state, 22000, { name: "Alex" });
        expect(named.state.progress.passed).toContain("greet-by-name");
        expect(
          named.effects.filter(
            (e) => e.kind === "event" && e.name === "tutorial_step_passed"
          )
        ).toEqual([
          {
            kind: "event",
            name: "tutorial_step_passed",
            params: {
              tutorial: "hello-anchor",
              step: 4,
              via: "chat",
              seconds: 7,
            },
          },
        ]);
      });
    });

    describe("the planned failure", () => {
      const failed = () =>
        play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: FAILED_BUILD, at: 8200 },
        ]).state;

      it("explain enters onFail and posts the explanation and the fix question", () => {
        const r = reduce(ctx(), failed(), {
          type: "explain",
          beatId: "s1.build",
          at: 9000,
        });
        expect(r.state.progress.cursor).toEqual({
          kind: "step",
          stepId: "write-program",
          beat: 2,
          fail: true,
        });
        expect(r.state.progress.beats["f1.explain"]).toEqual({
          kind: "said",
          at: 9000,
        });
        expect(r.state.progress.beats["f1.q2"]).toEqual({
          kind: "open",
          at: 9000 + TICK_MS,
          wrong: [],
        });
        expect(r.effects).toEqual([]);
      });

      it("fix it myself skips the explanation, posts the fix question and focuses the line", () => {
        const r = reduce(ctx(), failed(), {
          type: "fixMyself",
          beatId: "s1.build",
          at: 9000,
        });
        expect(r.state.progress.beats["f1.explain"]).toBeUndefined();
        expect(r.state.progress.beats["f1.q2"]).toEqual({
          kind: "open",
          at: 9000,
          wrong: [],
        });
        expect(r.effects).toEqual([
          { kind: "focus", file: "src/lib.rs", line: 9 },
        ]);
      });

      it("the fix question's build passes the step, and an open fix question reads typed", () => {
        const { progress } = play(
          [
            { type: "fixMyself", beatId: "s1.build", at: 9000 },
            { type: "act", beatId: "f1.build", at: 9500 },
          ],
          failed()
        );
        // f1.build is not reached: the question is open and flow stopped at it
        expect(progress.runs["f1.build"]).toBeUndefined();
        const fixed = play(
          [
            { type: "fixMyself", beatId: "s1.build", at: 9000 },
            {
              type: "edit",
              file: "src/lib.rs",
              content: "#[derive(Accounts)]\npub struct Hello {}\n",
              at: 9400,
            },
            { type: "act", beatId: "f1.build", at: 9500 },
            { type: "ended", beatId: "f1.build", result: OK_BUILD, at: 11000 },
          ],
          failed()
        ).progress;
        expect(fixed.beats["f1.q2"]).toMatchObject({ kind: "typed" });
        expect(fixed.passed).toEqual(["write-program"]);
      });

      it("a build that fails again before Explain is still the planned one", () => {
        const again = play(
          [
            build(9000),
            {
              type: "ended",
              beatId: "s1.build",
              result: FAILED_BUILD,
              at: 9800,
            },
            { type: "explain", beatId: "s1.build", at: 10000 },
          ],
          failed()
        ).progress;
        expect(again.cursor).toMatchObject({ fail: true });
        // Both failed builds stay, the first as a record
        expect(again.runs["s1.build"].map((r) => r.status)).toEqual([
          "failed",
          "failed",
        ]);
      });

      it("plans only a failure whose log holds the step's line", () => {
        const other: RunResult = {
          act: "build",
          ok: false,
          seconds: 1,
          reason: "compiler",
          error: {
            code: "E0308",
            file: "src/lib.rs",
            line: 10,
            column: 9,
            message: "mismatched types",
          },
          log: "error[E0308]: mismatched types",
        };
        const { progress } = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: other, at: 7100 },
        ]);
        expect(progress.runs["s1.build"]).toEqual([
          { status: "failed", at: 7000, took: 100, result: other },
        ]);
      });

      it("hands the step's line to its first build, never to the second", () => {
        const first = play([start, rightPick, build(7000)]).effects.find(
          (e) => e.kind === "run"
        );
        expect(first).toMatchObject({
          input: {
            beatId: "s1.build",
            failsWith: "cannot find type `Hello` in this scope",
          },
        });
        const inFail = reduce(ctx(), failed(), {
          type: "explain",
          beatId: "s1.build",
          at: 9000,
        }).state;
        const fixed = reduce(ctx(), inFail, {
          type: "pick",
          beatId: "f1.q2",
          option: 2,
          at: 9500,
        }).state;
        const second = reduce(ctx(), fixed, {
          type: "act",
          beatId: "f1.build",
          at: 12000,
        }).effects.find((e) => e.kind === "run");
        expect(second).toMatchObject({ input: { beatId: "f1.build" } });
        expect(second).not.toHaveProperty("input.failsWith");
      });

      it("explains nothing on a build refused for sign-in", () => {
        const refused: RunResult = {
          act: "build",
          ok: false,
          seconds: 0,
          reason: "signed_out",
          error: null,
          log: "Sign in with GitHub to build.",
        };
        const stopped = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: refused, at: 7100 },
        ]).state;
        expect(stopped.progress.runs["s1.build"]).toEqual([
          { status: "failed", at: 7000, took: 100, result: refused },
        ]);
        const r = reduce(ctx(), stopped, {
          type: "explain",
          beatId: "s1.build",
          at: 8000,
        });
        expect(r.state).toBe(stopped);
        expect(r.effects).toEqual([]);
      });

      it("marks the planned failure on its run, never a build that could not run", () => {
        expect(failed().progress.runs["s1.build"]).toMatchObject([
          { status: "failed", planned: true },
        ]);
        const noCompiler: RunResult = {
          act: "build",
          ok: false,
          seconds: 0,
          reason: "unreachable",
          error: null,
          log: "Server request failed: Failed to fetch",
        };
        const notPlanned = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: noCompiler, at: 7100 },
        ]).state;
        expect(notPlanned.progress.runs["s1.build"]).toEqual([
          { status: "failed", at: 7000, took: 100, result: noCompiler },
        ]);
        const r = reduce(ctx(), notPlanned, {
          type: "explain",
          beatId: "s1.build",
          at: 8000,
        });
        // A server that never answered has nothing to explain: its card
        // offers Try again instead
        expect(r.state).toBe(notPlanned);
        expect(r.effects).toEqual([]);
      });

      it("a failed build inside onFail is not planned again", () => {
        const inFail = play(
          [
            { type: "explain", beatId: "s1.build", at: 9000 },
            { type: "pick", beatId: "f1.q2", option: 2, at: 9500 },
            { type: "act", beatId: "f1.build", at: 10000 },
            {
              type: "ended",
              beatId: "f1.build",
              result: FAILED_BUILD,
              at: 11000,
            },
          ],
          failed()
        ).state;
        expect(inFail.progress.runs["f1.build"]).toMatchObject([
          { status: "failed" },
        ]);
        expect(inFail.progress.runs["f1.build"][0]).not.toHaveProperty(
          "planned"
        );
        const r = reduce(ctx(), inFail, {
          type: "explain",
          beatId: "f1.build",
          at: 12000,
        });
        expect(r.effects).toEqual([
          { kind: "explain", beatId: "f1.build", result: FAILED_BUILD },
        ]);
      });

      it("an unplanned failure goes to the assistant", () => {
        // Step 2 has no onFail: a failed build there is not planned
        const s2 = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
          { type: "next", at: 9000 },
          { type: "skip", beatId: "s2.q2", at: 9500 },
          { type: "act", beatId: "s2.airdrop", at: 9510 },
          {
            type: "ended",
            beatId: "s2.airdrop",
            result: AIRDROPPED,
            at: 9520,
          },
          { type: "act", beatId: "s2.deploy", at: 10000 },
          {
            type: "ended",
            beatId: "s2.deploy",
            result: FAILED_DEPLOY,
            at: 11000,
          },
        ]).state;
        const r = reduce(ctx(), s2, {
          type: "explain",
          beatId: "s2.deploy",
          at: 12000,
        });
        expect(r.state.progress.runs["s2.deploy"].at(-1)).toMatchObject({
          status: "failed",
          explainedAt: 12000,
        });
        expect(r.effects).toEqual([
          { kind: "explain", beatId: "s2.deploy", result: FAILED_DEPLOY },
        ]);
        // Asked once: a second press sends nothing
        expect(
          reduce(ctx(), r.state, {
            type: "explain",
            beatId: "s2.deploy",
            at: 12500,
          }).effects
        ).toEqual([]);
      });

      describe("Show me the fix", () => {
        const UNPLANNED: RunResult = {
          act: "build",
          ok: false,
          seconds: 1,
          reason: "compiler",
          error: {
            code: "E0308",
            file: "src/lib.rs",
            line: 10,
            column: 9,
            message: "mismatched types",
          },
          log: "error[E0308]: mismatched types",
        };
        const explained = () =>
          play([
            start,
            rightPick,
            build(7000),
            { type: "ended", beatId: "s1.build", result: UNPLANNED, at: 8000 },
            { type: "explain", beatId: "s1.build", at: 9000 },
          ]).state;

        it("records the assistant's answer, once, and never a fix before Explain", () => {
          const unexplained = play([
            start,
            rightPick,
            build(7000),
            { type: "ended", beatId: "s1.build", result: UNPLANNED, at: 8000 },
          ]).state;
          const early = reduce(ctx(), unexplained, {
            type: "showFix",
            beatId: "s1.build",
            at: 8100,
          });
          expect(early.state).toBe(unexplained);
          expect(early.effects).toEqual([]);
          const answered = reduce(ctx(), explained(), {
            type: "answered",
            beatId: "s1.build",
            at: 9500,
          }).state;
          expect(answered.progress.runs["s1.build"].at(-1)).toMatchObject({
            explainedAt: 9000,
            answeredAt: 9500,
          });
        });

        it("writes the step's target into its file, once", () => {
          const answered = reduce(ctx(), explained(), {
            type: "answered",
            beatId: "s1.build",
            at: 9500,
          }).state;
          const r = reduce(ctx(), answered, {
            type: "showFix",
            beatId: "s1.build",
            at: 10000,
          });
          expect(r.effects).toEqual([
            {
              kind: "restore",
              files: { "src/lib.rs": hello.steps[0].target["src/lib.rs"] },
              remove: [],
            },
          ]);
          expect(r.state.progress.runs["s1.build"].at(-1)).toMatchObject({
            fixedAt: 10000,
          });
          const again = reduce(ctx(), r.state, {
            type: "showFix",
            beatId: "s1.build",
            at: 10500,
          });
          expect(again.state).toBe(r.state);
          expect(again.effects).toEqual([]);
        });

        it("writes nothing once the step has passed", () => {
          const passedStep = reduce(ctx(), explained(), {
            type: "passed",
            via: "client",
            result: OK_BUILD,
            at: 9600,
          }).state;
          expect(
            reduce(ctx(), passedStep, {
              type: "showFix",
              beatId: "s1.build",
              at: 10000,
            }).effects
          ).toEqual([]);
        });
      });
    });

    describe("passed from outside the feed", () => {
      it("a client run passing the step skips its open question from elsewhere, writing nothing", () => {
        const { progress, effects } = play([
          start,
          { type: "passed", via: "client", result: OK_BUILD, at: 4000 },
        ]);
        expect(progress.beats["s1.q1"]).toEqual({
          kind: "skipped",
          at: 4000,
          openedAt: 1000 + 2 * TICK_MS,
          via: "elsewhere",
          wrong: [],
        });
        expect(progress.times["write-program"]).toEqual({
          from: 1000,
          to: 4000,
          via: "client",
        });
        expect(
          effects.filter((e) => e.kind === "write" && e.beatId === "s1.q1")
        ).toEqual([]);
      });

      it("explain and fix it myself are no-ops on a passed step the cursor is still on", () => {
        const passedHere = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: FAILED_BUILD, at: 8200 },
          { type: "passed", via: "call_panel", result: OK_BUILD, at: 8500 },
        ]).state;
        expect(passedHere.progress.cursor).toMatchObject({
          stepId: "write-program",
        });
        expect(
          reduce(ctx(), passedHere, {
            type: "explain",
            beatId: "s1.build",
            at: 9000,
          }).state
        ).toBe(passedHere);
        expect(
          reduce(ctx(), passedHere, {
            type: "fixMyself",
            beatId: "s1.build",
            at: 9000,
          }).state
        ).toBe(passedHere);
      });

      it("fix it myself on an unplanned failure only focuses the landing", () => {
        const s2 = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
          { type: "next", at: 9000 },
          { type: "skip", beatId: "s2.q2", at: 9500 },
          { type: "act", beatId: "s2.airdrop", at: 9510 },
          {
            type: "ended",
            beatId: "s2.airdrop",
            result: AIRDROPPED,
            at: 9520,
          },
          { type: "act", beatId: "s2.deploy", at: 10000 },
          {
            type: "ended",
            beatId: "s2.deploy",
            result: FAILED_DEPLOY,
            at: 11000,
          },
        ]).state;
        const r = reduce(ctx(), s2, {
          type: "fixMyself",
          beatId: "s2.deploy",
          at: 12000,
        });
        expect(r.state).toBe(s2);
        expect(r.effects).toEqual([
          { kind: "focus", file: "src/lib.rs", line: "landing" },
        ]);
      });

      it("explain and fix it myself are no-ops once the step has passed", () => {
        const left = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: FAILED_BUILD, at: 8200 },
          { type: "passed", via: "call_panel", result: OK_BUILD, at: 8500 },
          { type: "next", at: 9000 },
        ]).state;
        expect(
          reduce(ctx(), left, { type: "explain", beatId: "s1.build", at: 9500 })
            .state
        ).toBe(left);
        expect(
          reduce(ctx(), left, {
            type: "fixMyself",
            beatId: "s1.build",
            at: 9500,
          }).state
        ).toBe(left);
      });

      it("passes the step through the judge and skips its open question as called from the panel", () => {
        const { progress } = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
          { type: "next", at: 9000 },
          {
            type: "passed",
            via: "call_panel",
            result: {
              act: "call",
              ok: true,
              seconds: 1,
              signatures: ["x"],
              line: null,
              called: [],
            },
            at: 9500,
          },
        ]);
        expect(progress.passed).toEqual(["write-program", "deploy"]);
        expect(progress.times.deploy).toEqual({
          from: 9000,
          to: 9500,
          via: "call_panel",
        });
        expect(progress.beats["s2.q2"]).toEqual({
          kind: "skipped",
          at: 9500,
          openedAt: 9000 + TICK_MS,
          via: "call_panel",
          wrong: [],
        });
      });
    });

    describe("next and finish", () => {
      const toFinish = (): Action[] => [
        start,
        rightPick,
        build(7000),
        { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
        { type: "next", at: 9000 },
        {
          type: "passed",
          via: "call_panel",
          result: {
            act: "call",
            ok: true,
            seconds: 1,
            signatures: [],
            line: null,
            called: [],
          },
          at: 9500,
        },
        { type: "next", at: 10000 },
        {
          type: "passed",
          via: "call_panel",
          result: {
            act: "call",
            ok: true,
            seconds: 1,
            signatures: [],
            line: null,
            called: [],
          },
          at: 10500,
        },
        { type: "next", at: 11000 },
        {
          type: "passed",
          via: "call_panel",
          result: {
            act: "call",
            ok: true,
            seconds: 1,
            signatures: [],
            line: null,
            called: [],
          },
          at: 11500,
        },
      ];

      it("next needs a live win and enters the next step", () => {
        const before = play([start]).state;
        expect(reduce(ctx(), before, { type: "next", at: 2000 }).state).toBe(
          before
        );
        const { progress } = play(toFinish().slice(0, 5));
        expect(progress.cursor).toMatchObject({
          kind: "step",
          stepId: "deploy",
        });
        expect(progress.times.deploy).toEqual({ from: 9000, to: null });
        expect(progress.beats["s2.why"]).toEqual({ kind: "said", at: 9000 });
      });

      it("the last step's win has no next, and finish emits tutorial_finished", () => {
        const done = play(toFinish()).state;
        expect(done.progress.passed).toHaveLength(4);
        expect(reduce(ctx(), done, { type: "next", at: 12000 }).state).toBe(
          done
        );
        const r = reduce(ctx(), done, { type: "finish", at: 12000 });
        expect(r.state.progress.cursor).toEqual({ kind: "finished" });
        expect(r.state.progress.finishedAt).toBe(12000);
        expect(r.effects).toEqual([
          {
            kind: "event",
            name: "tutorial_finished",
            params: { tutorial: "hello-anchor", seconds: 11 },
          },
        ]);
        expect(
          reduce(ctx(), r.state, { type: "finish", at: 13000 }).state
        ).toBe(r.state);
      });

      it("a finish chip posts only after the finish, and is counted as asked", () => {
        const done = play(toFinish()).state;
        expect(
          reduce(ctx(), done, { type: "chip", index: 0, at: 12000 }).state
        ).toBe(done);
        const finished = reduce(ctx(), done, {
          type: "finish",
          at: 12000,
        }).state;
        const r = reduce(ctx(), finished, {
          type: "chip",
          index: 1,
          at: 13000,
        });
        expect(r.state.progress.said).toEqual([
          { kind: "chip", index: 1, at: 13000 },
        ]);
        expect(r.effects).toEqual([
          {
            kind: "event",
            name: "tutorial_question_asked",
            params: { tutorial: "hello-anchor", step: 4, source: "chip" },
          },
        ]);
        expect(
          reduce(ctx(), finished, { type: "chip", index: 3, at: 13000 }).state
        ).toBe(finished);
      });

      it("finish before the last win is a no-op", () => {
        const before = play(toFinish().slice(0, 4)).state;
        expect(reduce(ctx(), before, { type: "finish", at: 9000 }).state).toBe(
          before
        );
      });
    });

    describe("restart the step", () => {
      it("plays the live step again from its start files, keeping other steps", () => {
        const picked = play([start, rightPick]).state;
        const r = reduce(ctx(), picked, { type: "restartStep", at: 9000 });
        const step1 = hello.steps[0];
        expect(r.state.progress.cursor).toMatchObject({
          kind: "step",
          stepId: step1.id,
        });
        // The answered question is asked again
        expect(r.state.progress.beats["s1.q1"]).toMatchObject({
          kind: "open",
          wrong: [],
        });
        expect(r.state.progress.times[step1.id]).toEqual({
          from: 9000,
          to: null,
        });
        expect(r.state.progress.startedAt).toBe(1000);
        expect(r.effects[0]).toEqual({
          kind: "restore",
          files: step1.start,
          remove: [],
        });
        expect(r.effects[1]).toEqual({
          kind: "event",
          name: "tutorial_step_reset",
          params: { tutorial: "hello-anchor", step: 1 },
        });
        // Its first beat, the boilerplate's write, comes round again
        expect(r.effects).toContainEqual(
          expect.objectContaining({ kind: "write", beatId: "s1.boil" })
        );
      });

      it("takes away a file the step creates", () => {
        const step3 = hello.steps[2];
        const on3 = play([start]).state;
        on3.progress.cursor = {
          kind: "step",
          stepId: step3.id,
          beat: 1,
          fail: false,
        };
        const r = reduce(ctx(), on3, { type: "restartStep", at: 9000 });
        expect(r.effects[0]).toEqual({
          kind: "restore",
          files: step3.start,
          remove: ["client/client.ts"],
        });
      });

      it("is refused on the intro, once the step passed, and while an act runs", () => {
        expect(
          reduce(ctx(), INITIAL_ENGINE_STATE, { type: "restartStep", at: 9 })
            .state
        ).toBe(INITIAL_ENGINE_STATE);
        const won = play([start, rightPick]).state;
        won.progress.passed = [hello.steps[0].id];
        expect(
          reduce(ctx(), won, { type: "restartStep", at: 9000 }).state
        ).toBe(won);
        const busy = play([start, rightPick]).state;
        busy.progress.runs = { "s1.build": [{ status: "started", at: 6000 }] };
        expect(
          reduce(ctx(), busy, { type: "restartStep", at: 9000 }).state
        ).toBe(busy);
      });
    });

    describe("start over", () => {
      it("returns to the intro with nothing kept", () => {
        const midway = play([start, rightPick]).state;
        const r = reduce(ctx(), midway, { type: "startOver", at: 9000 });
        expect(r.state.progress).toEqual(freshProgress(9000));
        expect(r.state.stage).toBeNull();
        expect(r.effects).toEqual([
          { kind: "restore", files: hello.intro.files, remove: [] },
        ]);
      });
    });

    describe("the composer", () => {
      const proposal = {
        id: "p1",
        file: "programs/hello/src/lib.rs",
        line: 10,
        before: "        old",
        after: "        new",
      };

      it("a word runs its action and posts its pill, counted as sent", () => {
        const r = play([
          {
            type: "word",
            word: "start",
            text: "Go!",
            then: { type: "start", at: 1000 },
            at: 1000,
          },
        ]);
        expect(r.progress.startedAt).toBe(1000);
        expect(r.progress.said).toEqual([
          { kind: "word", text: "Go!", at: 1000 },
        ]);
        expect(r.effects).toContainEqual({
          kind: "event",
          name: "tutorial_word_sent",
          params: {
            tutorial: "hello-anchor",
            step: 0,
            word: "start",
            refused: false,
          },
        });
        expect(r.effects).toContainEqual({
          kind: "event",
          name: "tutorial_started",
          params: { tutorial: "hello-anchor" },
        });
      });

      it("a word whose action the engine refuses posts no pill", () => {
        const before = play([start]).state;
        const r = reduce(ctx(), before, {
          type: "word",
          word: "next",
          text: "next",
          then: { type: "next", at: 2000 },
          at: 2000,
        });
        expect(r.state).toBe(before);
        expect(r.effects).toEqual([]);
      });

      it("a refused word posts the refusal and runs nothing", () => {
        const before = play([start]).state;
        const r = reduce(ctx(), before, {
          type: "refuseWord",
          word: "build",
          text: "build",
          at: 3000,
        });
        expect(r.state.progress.said).toEqual([
          { kind: "refused", text: "build", at: 3000 },
        ]);
        expect(r.state.progress.runs).toEqual(before.progress.runs);
        expect(r.effects).toEqual([
          {
            kind: "event",
            name: "tutorial_word_sent",
            params: {
              tutorial: "hello-anchor",
              step: 1,
              word: "build",
              refused: true,
            },
          },
        ]);
      });

      it("a message to the assistant is counted and saves nothing", () => {
        const before = play([start]).state;
        const r = reduce(ctx(), before, {
          type: "asked",
          cursor: before.progress.cursor,
          at: 3000,
        });
        expect(r.state).toBe(before);
        expect(r.effects).toEqual([
          {
            kind: "event",
            name: "tutorial_question_asked",
            params: { tutorial: "hello-anchor", step: 1, source: "typed" },
          },
        ]);
      });

      it("counts a message on the step it was asked on, not the one its answer ended on", () => {
        const intro = play([]).state.progress.cursor;
        const r = reduce(ctx(), play([start]).state, {
          type: "asked",
          cursor: intro,
          at: 3000,
        });
        expect(r.effects).toEqual([
          {
            kind: "event",
            name: "tutorial_question_asked",
            params: { tutorial: "hello-anchor", step: 0, source: "typed" },
          },
        ]);
      });

      it("a proposal waits; Apply asks for the write, and only the write applies it", () => {
        const proposed = play([
          start,
          { type: "propose", proposal, at: 4000 },
          { type: "propose", proposal, at: 4100 },
        ]).state;
        expect(proposed.progress.proposals).toEqual([
          {
            id: "p1",
            file: "programs/hello/src/lib.rs",
            line: 10,
            before: "        old",
            after: "        new",
            at: 4000,
            state: "open",
          },
        ]);
        const asked = reduce(ctx(), proposed, {
          type: "apply",
          id: "p1",
          at: 5000,
        });
        expect(asked.state).toBe(proposed);
        expect(asked.effects).toEqual([
          {
            kind: "apply",
            id: "p1",
            file: "programs/hello/src/lib.rs",
            line: 10,
            before: "        old",
            after: "        new",
          },
        ]);
        const failed = reduce(ctx(), proposed, {
          type: "applyFailed",
          id: "p1",
          reason: "moved",
          at: 5100,
        });
        expect(failed.state.progress.proposals[0]).toMatchObject({
          state: "open",
          applyFailed: "moved",
        });
        // A write that failed sends nothing
        expect(failed.effects).toEqual([]);
        const applied = reduce(ctx(), failed.state, {
          type: "applied",
          id: "p1",
          at: 5200,
        });
        expect(applied.state.progress.proposals[0].state).toBe("applied");
        expect(applied.state.progress.proposals[0].applyFailed).toBeUndefined();
        expect(applied.effects).toEqual([
          {
            kind: "event",
            name: "tutorial_change_applied",
            params: {
              tutorial: "hello-anchor",
              file: "programs/hello/src/lib.rs",
            },
          },
        ]);
        // Settled once: neither Apply nor Keep it moves it again
        expect(
          reduce(ctx(), applied.state, { type: "keep", id: "p1", at: 6000 })
            .state
        ).toBe(applied.state);
        expect(
          reduce(ctx(), applied.state, { type: "apply", id: "p1", at: 6000 })
            .effects
        ).toEqual([]);
      });

      it("Keep it leaves the file and is counted", () => {
        const proposed = play([
          start,
          { type: "propose", proposal, at: 4000 },
        ]).state;
        const r = reduce(ctx(), proposed, { type: "keep", id: "p1", at: 5000 });
        expect(r.state.progress.proposals[0].state).toBe("kept");
        expect(r.effects).toEqual([
          {
            kind: "event",
            name: "tutorial_change_kept",
            params: { tutorial: "hello-anchor" },
          },
        ]);
      });

      it("a step's Reset keeps the records, and Start over clears them", () => {
        const said = play([
          start,
          { type: "refuseWord", word: "build", text: "build", at: 3000 },
          { type: "propose", proposal, at: 4000 },
        ]).state;
        const reset = reduce(ctx(), said, { type: "restartStep", at: 5000 });
        expect(reset.state.progress.said).toEqual(said.progress.said);
        expect(reset.state.progress.proposals).toEqual(said.progress.proposals);
        const over = reduce(ctx(), said, { type: "startOver", at: 6000 });
        expect(over.state.progress.said).toEqual([]);
        expect(over.state.progress.proposals).toEqual([]);
      });
    });

    describe("a refused call and argument values", () => {
      const act = (
        id: string,
        instruction: string,
        args: CallArg[] | undefined,
        button: string
      ): Beat =>
        args
          ? {
              kind: "act",
              id,
              act: "call",
              title: button,
              context: `Sends ${instruction}`,
              button,
              call: { instruction, args },
            }
          : {
              kind: "act",
              id,
              act: "call",
              title: button,
              context: `Sends ${instruction}`,
              button,
              call: { instruction },
            };
      const step = (id: string, beats: Beat[], goal: Goal): Step => ({
        id,
        title: id,
        short: id,
        objective: id,
        learned: id,
        file: "src/lib.rs",
        start: { "src/lib.rs": "" },
        target: { "src/lib.rs": "" },
        beats,
        goal,
        win: { id: `${id}.win`, headline: "Won", line: "Won." },
        explain: id,
      });

      /** Lumberjack's chop and refill steps, and Zero Copy's grow and paint */
      const lesson = (): TutorialDefinition => ({
        version: 1,
        name: "Refusals",
        description: "Refused calls.",
        authors: [{ name: "Fleet" }],
        level: "Intermediate",
        framework: "Anchor",
        languages: ["Rust"],
        thumbnail: "thumbnail.jpg",
        minutes: 5,
        intro: { promise: "p", log: "l", files: { "src/lib.rs": "" } },
        steps: [
          step("chop", [act("s3.chop", "chop_tree", undefined, "Chop")], {
            kind: "refused",
            instruction: "chop_tree",
            error: { name: "NotEnoughEnergy", code: 6000 },
          }),
          step("refill", [act("s4.chop", "chop_tree", undefined, "Chop")], {
            kind: "call",
            instruction: "chop_tree",
          }),
          step(
            "grow",
            [
              act(
                "s2.grow",
                "grow",
                [{ name: "len", value: 20480, add: 10240 }],
                "Grow +10 KB"
              ),
            ],
            { kind: "refused", instruction: "grow", log: "out of memory" }
          ),
          step(
            "paint",
            [
              act(
                "s3.paint",
                "paint",
                [
                  "note",
                  { name: "text", value: "gm" },
                  { name: "at", value: 35000 },
                ],
                "Paint"
              ),
            ],
            { kind: "call", instruction: "paint" }
          ),
          // Zero Copy's create step (HOO-2362)
          step("create", [act("s2.create", "init_map", undefined, "Create")], {
            kind: "call",
            instruction: "init_map",
            creates: "map",
          }),
          // The counter's second pass (HOO-2730): a one-time call before the goal
          step(
            "count",
            [
              {
                kind: "act",
                id: "s4.init",
                act: "call",
                title: "Init",
                context: "Sends initialize",
                button: "Init",
                call: { instruction: "initialize", creates: "counter" },
              },
              act("s4.inc", "increment", undefined, "Increment"),
            ],
            { kind: "call", instruction: "increment" }
          ),
          // The act's own account and the goal's, on one step
          step(
            "both",
            [
              {
                kind: "act",
                id: "s5.init",
                act: "call",
                title: "Init",
                context: "Sends initialize",
                button: "Init",
                call: { instruction: "initialize", creates: "counter" },
              },
              act("s5.inc", "increment", undefined, "Increment"),
            ],
            { kind: "call", instruction: "increment", creates: "tally" }
          ),
          // A one-time call in the fix path, after the step's first try failed
          {
            id: "fix",
            title: "fix",
            short: "fix",
            objective: "fix",
            learned: "fix",
            file: "src/lib.rs",
            start: { "src/lib.rs": "" },
            target: { "src/lib.rs": "" },
            beats: [act("s6.go", "increment", undefined, "Go")],
            goal: { kind: "call", instruction: "increment" },
            win: { id: "fix.win", headline: "Won", line: "Won." },
            explain: "fix",
            planned: "It fails to build.",
            failsWith: "error\\[E0425\\]",
            onFail: [
              {
                kind: "act",
                id: "s6.init",
                act: "call",
                title: "Init",
                context: "Sends initialize",
                button: "Init",
                call: { instruction: "initialize", creates: "counter" },
              },
              act("s6.inc", "increment", undefined, "Increment"),
            ],
          },
        ],
        finish: {
          headline: "Done",
          line: "Done.",
          learned: ["Refusals"],
          chips: [],
          next: null,
        },
      });

      let realCtx: EngineContext;
      beforeAll(() => {
        realCtx = { definition: lesson(), slug: "refusals", judge: judgeGoal };
      });

      const run = (actions: Action[], from = INITIAL_ENGINE_STATE) => {
        let state = from;
        const effects: Effect[] = [];
        for (const a of actions) {
          const r = reduce(realCtx, state, a);
          state = r.state;
          effects.push(...r.effects);
        }
        return { state, progress: state.progress, effects };
      };

      /** The cursor on the step at `index`, its act posted at 1000 */
      const at = (index: number): EngineState => {
        const { steps } = realCtx.definition;
        const here = steps[index];
        return {
          progress: {
            version: 1,
            passed: steps.slice(0, index).map((s) => s.id),
            finishedAt: null,
            startedAt: 1000,
            restartedAt: null,
            said: [],
            proposals: [],
            accounts: {},
            cursor: { kind: "step", stepId: here.id, beat: 1, fail: false },
            beats: { [here.beats[0].id]: { kind: "said", at: 1000 } },
            runs: {},
            times: { [here.id]: { from: 1000, to: null } },
          },
          stage: null,
        };
      };

      const refusal = (
        instruction: string,
        error: Refusal["error"],
        log = ""
      ): RunResult => ({
        act: "call",
        ok: false,
        seconds: 1,
        message: "Transaction failed",
        log,
        refused: { instruction, error },
      });
      const landed = (instruction: string): RunResult => ({
        act: "call",
        ok: true,
        seconds: 1,
        signatures: ["sig"],
        line: null,
        called: [{ instruction, args: {} }],
      });
      const press = (
        beatId: string,
        t: number,
        args?: Record<string, string>
      ): Action =>
        args
          ? { type: "act", beatId, args, at: t }
          : { type: "act", beatId, at: t };
      const ended = (beatId: string, t: number, result: RunResult): Action => ({
        type: "ended",
        beatId,
        startedAt: t,
        result,
        at: t + 900,
      });

      it("a refusal the goal expects is recorded refused and passes the step", () => {
        const out = refusal("chop_tree", {
          code: 6000,
          name: "NotEnoughEnergy",
        });
        const { progress, effects } = run(
          [press("s3.chop", 2000), ended("s3.chop", 2000, out)],
          at(0)
        );
        expect(progress.runs["s3.chop"]).toEqual([
          { status: "refused", at: 2000, took: 900, result: out },
        ]);
        expect(progress.passed).toEqual(["chop"]);
        expect(effects).toContainEqual({
          kind: "event",
          name: "tutorial_step_passed",
          params: { tutorial: "refusals", step: 1, via: "chat", seconds: 2 },
        });
      });

      describe("the create step", () => {
        const MAP = {
          instruction: "init_map",
          account: "map",
          address: "Map1",
        };
        const inUse = (exists: typeof MAP | undefined): RunResult =>
          exists
            ? {
                act: "call",
                ok: false,
                seconds: 1,
                message: "custom program error: 0x0",
                log: "",
                refused: {
                  instruction: "init_map",
                  error: { code: 0, name: null },
                },
                exists,
              }
            : {
                act: "call",
                ok: false,
                seconds: 1,
                message: "custom program error: 0x0",
                log: "",
                refused: {
                  instruction: "init_map",
                  error: { code: 0, name: null },
                },
              };

        it("sends the account its goal creates with the call", () => {
          const { effects } = run([press("s2.create", 2000)], at(4));
          expect(effects).toContainEqual(
            expect.objectContaining({
              kind: "run",
              input: expect.objectContaining({
                creates: { instruction: "init_map", account: "map" },
              }),
            })
          );
        });

        it("passes on a map that already exists, recorded refused, with reason exists", () => {
          const out = inUse(MAP);
          const { progress, effects } = run(
            [press("s2.create", 2000), ended("s2.create", 2000, out)],
            at(4)
          );
          expect(progress.runs["s2.create"]).toEqual([
            { status: "refused", at: 2000, took: 900, result: out },
          ]);
          expect(progress.times.create).toMatchObject({ reason: "exists" });
          expect(effects).toContainEqual({
            kind: "event",
            name: "tutorial_step_passed",
            params: {
              tutorial: "refusals",
              step: 5,
              via: "chat",
              seconds: 2,
              reason: "exists",
            },
          });
        });

        it("stays failed on a call refused for another reason", () => {
          const { progress } = run(
            [
              press("s2.create", 2000),
              ended("s2.create", 2000, inUse(undefined)),
            ],
            at(4)
          );
          expect(progress.runs["s2.create"]?.[0]?.status).toBe("failed");
          expect(progress.passed).not.toContain("create");
        });
      });

      describe("a one-time call before the goal (HOO-2730)", () => {
        const COUNTER = {
          instruction: "initialize",
          account: "counter",
          address: "Counter1",
        };
        const refusedInit = (exists?: typeof COUNTER): RunResult =>
          exists
            ? {
                act: "call",
                ok: false,
                seconds: 1,
                message: "custom program error: 0x0",
                log: "",
                refused: {
                  instruction: "initialize",
                  error: { code: 0, name: null },
                },
                exists,
              }
            : {
                act: "call",
                ok: false,
                seconds: 1,
                message: "custom program error: 0x0",
                log: "",
                refused: {
                  instruction: "initialize",
                  error: { code: 0, name: null },
                },
              };

        it("sends the account its own call creates", () => {
          const { effects } = run([press("s4.init", 2000)], at(5));
          expect(effects).toContainEqual(
            expect.objectContaining({
              kind: "run",
              input: expect.objectContaining({
                creates: { instruction: "initialize", account: "counter" },
              }),
            })
          );
        });

        it("records an existing counter refused and posts the next card, without passing the step", () => {
          const out = refusedInit(COUNTER);
          const { progress } = run(
            [press("s4.init", 2000), ended("s4.init", 2000, out)],
            at(5)
          );
          expect(progress.runs["s4.init"]).toEqual([
            { status: "refused", at: 2000, took: 900, result: out },
          ]);
          expect(progress.beats["s4.inc"]).toMatchObject({ kind: "said" });
          expect(progress.passed).not.toContain("count");
        });

        it("passes the step on the goal's own call that follows", () => {
          const { progress } = run(
            [
              press("s4.init", 2000),
              ended("s4.init", 2000, refusedInit(COUNTER)),
              press("s4.inc", 4000),
              ended("s4.inc", 4000, landed("increment")),
            ],
            at(5)
          );
          expect(progress.passed).toContain("count");
          expect(progress.times.count?.reason).toBeUndefined();
        });

        it("stays failed on an existing account its call does not name", () => {
          const other = refusedInit({
            instruction: "initialize",
            account: "config",
            address: "Config1",
          });
          const { progress } = run(
            [press("s4.init", 2000), ended("s4.init", 2000, other)],
            at(5)
          );
          expect(progress.runs["s4.init"]?.[0]?.status).toBe("failed");
          expect(progress.beats["s4.inc"]).toBeUndefined();
        });

        it("sends its own account over one the goal creates", () => {
          const { effects } = run([press("s5.init", 2000)], at(6));
          expect(effects).toContainEqual(
            expect.objectContaining({
              input: expect.objectContaining({
                creates: { instruction: "initialize", account: "counter" },
              }),
            })
          );
        });

        it("stays failed and posts nothing on any other refusal", () => {
          const { progress } = run(
            [press("s4.init", 2000), ended("s4.init", 2000, refusedInit())],
            at(5)
          );
          expect(progress.runs["s4.init"]?.[0]?.status).toBe("failed");
          expect(progress.beats["s4.inc"]).toBeUndefined();
        });

        it("records a second press on the existing account refused again, and leaves the next card where the first posted it", () => {
          const first = run(
            [
              press("s4.init", 2000),
              ended("s4.init", 2000, refusedInit(COUNTER)),
            ],
            at(5)
          ).progress.beats["s4.inc"];
          const { progress } = run(
            [
              press("s4.init", 2000),
              ended("s4.init", 2000, refusedInit(COUNTER)),
              press("s4.init", 4000),
              ended("s4.init", 4000, refusedInit(COUNTER)),
            ],
            at(5)
          );
          expect(progress.runs["s4.init"]?.map((r) => r.status)).toEqual([
            "refused",
            "refused",
          ]);
          expect(first).toMatchObject({ kind: "said" });
          expect(progress.beats["s4.inc"]).toEqual(first);
          expect(progress.passed).not.toContain("count");
        });

        it("records the existing account refused inside onFail and posts the fix path's next card", () => {
          const { steps } = realCtx.definition;
          const fix = steps.findIndex((s) => s.id === "fix");
          expect(fix).toBeGreaterThan(-1);
          // The cursor in the fix path (`onFail`), its one-time call posted
          const from: EngineState = {
            progress: {
              version: 1,
              passed: steps.slice(0, fix).map((s) => s.id),
              finishedAt: null,
              startedAt: 1000,
              restartedAt: null,
              said: [],
              proposals: [],
              accounts: {},
              cursor: { kind: "step", stepId: "fix", beat: 1, fail: true },
              beats: {
                "s6.go": { kind: "said", at: 1000 },
                "s6.init": { kind: "said", at: 1500 },
              },
              runs: {},
              times: { fix: { from: 1000, to: null } },
            },
            stage: null,
          };
          const { progress } = run(
            [
              press("s6.init", 2000),
              ended("s6.init", 2000, refusedInit(COUNTER)),
            ],
            from
          );
          expect(progress.runs["s6.init"]?.[0]?.status).toBe("refused");
          expect(progress.beats["s6.inc"]).toMatchObject({ kind: "said" });
          expect(progress.passed).not.toContain("fix");
        });
      });

      it("chops that land before the refusal record and keep the card", () => {
        const { progress } = run(
          [
            press("s3.chop", 2000),
            ended("s3.chop", 2000, landed("chop_tree")),
            press("s3.chop", 3000),
            ended(
              "s3.chop",
              3000,
              refusal("chop_tree", { code: 6000, name: "NotEnoughEnergy" })
            ),
          ],
          at(0)
        );
        expect(progress.runs["s3.chop"].map((r) => r.status)).toEqual([
          "ok",
          "refused",
        ]);
        expect(progress.passed).toEqual(["chop"]);
      });

      it("a refusal the refused goal does not name stays failed and is explained", () => {
        const other = refusal("chop_tree", { code: 6001, name: "NoTrees" });
        const failed = run(
          [press("s3.chop", 2000), ended("s3.chop", 2000, other)],
          at(0)
        );
        expect(failed.progress.runs["s3.chop"]).toEqual([
          { status: "failed", at: 2000, took: 900, result: other },
        ]);
        expect(failed.progress.passed).toEqual([]);
        expect(
          run([{ type: "explain", beatId: "s3.chop", at: 4000 }], failed.state)
            .effects
        ).toEqual([{ kind: "explain", beatId: "s3.chop", result: other }]);
      });

      it("a learner's value never moves a growing one, and an interrupted run does not count as landed", () => {
        const interrupted: EngineState = {
          progress: {
            version: 1,
            passed: at(2).progress.passed,
            finishedAt: null,
            startedAt: 1000,
            restartedAt: null,
            said: [],
            proposals: [],
            accounts: {},
            cursor: at(2).progress.cursor,
            beats: at(2).progress.beats,
            runs: {
              "s2.grow": [
                { status: "interrupted", at: 1500 },
                {
                  status: "ok",
                  at: 1600,
                  took: 100,
                  result: landed("grow"),
                },
              ],
            },
            times: at(2).progress.times,
          },
          stage: null,
        };
        const { effects } = run(
          [press("s2.grow", 2000, { len: "1" })],
          interrupted
        );
        expect(effects).toEqual([
          {
            kind: "run",
            beatId: "s2.grow",
            act: "call",
            input: {
              beatId: "s2.grow",
              call: { instruction: "grow", args: { len: "30720" } },
            },
            startedAt: 2000,
          },
        ]);
      });

      it("a refusal from the Call panel passes the same goal", () => {
        const { progress } = run(
          [
            {
              type: "passed",
              via: "call_panel",
              result: refusal("chop_tree", {
                code: 6000,
                name: "NotEnoughEnergy",
              }),
              at: 2000,
            },
          ],
          at(0)
        );
        expect(progress.passed).toEqual(["chop"]);
        expect(progress.times.chop).toEqual({
          from: 1000,
          to: 2000,
          via: "call_panel",
        });
      });

      it("a refusal the goal does not expect stays failed and is explained", () => {
        const out = refusal("chop_tree", {
          code: 6000,
          name: "NotEnoughEnergy",
        });
        const failed = run(
          [press("s4.chop", 2000), ended("s4.chop", 2000, out)],
          at(1)
        );
        expect(failed.progress.runs["s4.chop"]).toEqual([
          { status: "failed", at: 2000, took: 900, result: out },
        ]);
        expect(failed.progress.passed).toEqual(["chop"]);
        expect(
          run([{ type: "explain", beatId: "s4.chop", at: 4000 }], failed.state)
            .effects
        ).toEqual([{ kind: "explain", beatId: "s4.chop", result: out }]);
      });

      it("a refused run offers no Explain and no fix", () => {
        const passedRun = run(
          [
            press("s3.chop", 2000),
            ended(
              "s3.chop",
              2000,
              refusal("chop_tree", { code: 6000, name: "NotEnoughEnergy" })
            ),
          ],
          at(0)
        ).state;
        expect(
          run(
            [
              { type: "explain", beatId: "s3.chop", at: 4000 },
              { type: "fixMyself", beatId: "s3.chop", at: 4100 },
            ],
            passedRun
          ).effects
        ).toEqual([]);
      });

      it("grows a value by each run that landed, and sends it again after a refusal", () => {
        const tooBig = refusal(
          "grow",
          null,
          "Program log: Error: an account can grow by at most 10,240 bytes in one instruction"
        );
        const { progress, effects } = run(
          [
            press("s2.grow", 2000),
            ended("s2.grow", 2000, landed("grow")),
            press("s2.grow", 3000),
            ended("s2.grow", 3000, tooBig),
            press("s2.grow", 4000),
            ended(
              "s2.grow",
              4000,
              refusal(
                "grow",
                null,
                "Program log: Error: memory allocation failed, out of memory"
              )
            ),
          ],
          at(2)
        );
        const sent = effects.flatMap((e) =>
          e.kind === "run" && e.input.call ? [e.input.call.args.len] : []
        );
        expect(sent).toEqual(["20480", "30720", "30720"]);
        expect(progress.runs["s2.grow"].map((r) => r.status)).toEqual([
          "ok",
          "failed",
          "refused",
        ]);
        expect(progress.passed).toContain("grow");
      });

      it("sends fixed values over a learner's, and a learner's for a field", () => {
        const { effects } = run(
          [press("s3.paint", 2000, { note: "hi", text: "nope", at: "1" })],
          at(3)
        );
        expect(effects).toEqual([
          {
            kind: "run",
            beatId: "s3.paint",
            act: "call",
            input: {
              beatId: "s3.paint",
              call: {
                instruction: "paint",
                args: { note: "hi", text: "gm", at: "35000" },
              },
            },
            startedAt: 2000,
          },
        ]);
      });
    });
  });
}
