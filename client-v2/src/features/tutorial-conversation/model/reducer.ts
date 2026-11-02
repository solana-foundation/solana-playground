import type {
  Act,
  ActBeat,
  Ask,
  Beat,
  CallArg,
  Step,
  TutorialDefinition,
} from "@/entities/tutorial";

import { TICK_MS } from "./clock";
import { holds, keyOf, typedKey } from "./landing";
import { freshProgress } from "./progress";
import type {
  ConversationProgress,
  Cursor,
  PassedVia,
  Resolution,
  RunRecord,
  RunResult,
  SkipVia,
  Wrote,
} from "./progress";
import type { Judge, RunInput } from "./ports";

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
}

export const INITIAL_ENGINE_STATE: EngineState = {
  progress: freshProgress(),
  stage: null,
};

export type Action =
  | { type: "start"; at: number }
  | { type: "pick"; beatId: string; option: number; at: number }
  | { type: "hint"; beatId: string; at: number }
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
  /** A step's goal met outside the feed: a Call panel call or a client run */
  | {
      type: "passed";
      via: Exclude<PassedVia, "chat">;
      result: RunResult;
      at: number;
    }
  | { type: "explain"; beatId: string; at: number }
  | { type: "fixMyself"; beatId: string; at: number }
  | { type: "next"; at: number }
  | { type: "finish"; at: number }
  | { type: "startOver"; at: number };

export type Effect =
  | {
      kind: "write";
      beatId: string;
      file: string;
      block: string;
      /** The key line the learner typed, for a fill around it */
      key: string | null;
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
      name: "tutorial_finished";
      params: { tutorial: string; seconds: number };
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
      };
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

/** Whether a run is in flight: acts never run two at once */
const running = (p: ConversationProgress) =>
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
          : {
              kind: "write",
              beatId: b.id,
              file: b.writes.file,
              block: b.writes.block,
              key: null,
              at: t,
            }
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

/** The write a resolved question's answer queues, when it has one */
const answerWrite = (ask: Ask, key: string | null, at: number): Effect[] =>
  ask.writes
    ? [
        {
          kind: "write",
          beatId: ask.id,
          file: ask.writes.file,
          block: ask.writes.block,
          key,
          at,
        },
      ]
    : [];

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
  via: PassedVia
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
        ...(r.hintedAt ? { hintedAt: r.hintedAt } : {}),
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
    times: { ...p.times, [step.id]: { from, to: at, via } },
    beats,
  };
};

/**
 * Whether a failed build is the one the step plans: a compiler error (not a
 * run that could not happen), on a step with `onFail`, before the cursor
 * has entered it. Any such build counts, so a learner who runs the build
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
  result.error !== null &&
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

/** The step passes (see `pass`), and `tutorial_step_passed` says how and how long */
const passStep = (
  ctx: EngineContext,
  state: EngineState,
  p: ConversationProgress,
  step: Step,
  at: number,
  via: PassedVia
): Reduced => {
  const from = p.times[step.id]?.from ?? at;
  return withProgress(state, pass(ctx, p, step, at, via), [
    {
      kind: "event",
      name: "tutorial_step_passed",
      params: {
        tutorial: ctx.slug,
        step: ctx.definition.steps.indexOf(step) + 1,
        via,
        // Two devices' clocks can disagree; a pass never takes negative time
        seconds: Math.max(0, Math.round((at - from) / 1000)),
      },
    },
  ]);
};

export const reduce = (
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
        ...(open.hintedAt ? { hintedAt: open.hintedAt } : {}),
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
          [live.beat.id]: { ...live.open, hintedAt: action.at },
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
        ...(open.hintedAt ? { hintedAt: open.hintedAt } : {}),
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
        ...(open.hintedAt ? { hintedAt: open.hintedAt } : {}),
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
      // A run that ended well may run again while the step has not passed:
      // its result may have failed the goal (a call before the upgrade)
      const input: RunInput = { beatId: beat.id };
      if (beat.act === "call") {
        input.call = {
          instruction: beat.call.instruction,
          args: callArgs(beat.call.args ?? [], action.args ?? {}, p, beat.id),
        };
      }
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
      const { beatId, label, index, count } = action;
      return {
        state: { ...state, stage: { beatId, label, index, count } },
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
      // A refusal the step's goal names is its own outcome: it passes the
      // step below, and is no failure to explain
      const refused =
        !result.ok &&
        step.goal.kind === "refused" &&
        !passed(p, step) &&
        ctx.judge(step.goal, result);
      let record: RunRecord;
      if (result.ok) {
        record = { status: "ok", at: run.at, took, result };
      } else if (refused) {
        record = { status: "refused", at: run.at, took, result };
      } else if (isPlannedFailure(step, p.cursor, result)) {
        record = { status: "failed", at: run.at, took, result, planned: true };
      } else {
        record = { status: "failed", at: run.at, took, result };
      }
      const recorded: ConversationProgress = {
        ...p,
        runs: {
          ...p.runs,
          [beat.id]: [...p.runs[beat.id].slice(0, -1), record],
        },
      };
      const cleared: EngineState = { progress: recorded, stage: null };
      if (!result.ok && !refused) return same(cleared);
      if (
        refused ||
        (!passed(recorded, step) && ctx.judge(step.goal, result))
      ) {
        const via: PassedVia = beat.act === "run" ? "client" : "chat";
        return passStep(ctx, cleared, recorded, step, action.at, via);
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
        return same(cleared);
      }
      const flowed = flow(ctx, recorded, action.at + TICK_MS);
      return withProgress(cleared, flowed.progress, flowed.effects);
    }

    case "passed": {
      const step = stepAt(definition, p.cursor);
      if (!step || passed(p, step) || !ctx.judge(step.goal, action.result)) {
        return same(state);
      }
      return passStep(ctx, state, p, step, action.at, action.via);
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
        return {
          state,
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
  type CallArg = import("@/entities/tutorial").CallArg;
  type Goal = import("@/entities/tutorial").Goal;
  type Refusal = import("./progress").Refusal;

  describe("features/tutorial-conversation/model/reducer", () => {
    let hello: TutorialDefinition;
    let judgeGoal: typeof import("./goals").judgeGoal;
    beforeAll(async () => {
      hello = (await import("../../../tutorials/hello-anchor/tutorial.json"))
        .default as unknown as TutorialDefinition;
      judgeGoal = (await import("./goals")).judgeGoal;
    });

    const ctx = (): EngineContext => ({
      definition: hello,
      slug: "hello-anchor",
      judge: (_goal, result) => result.ok,
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
      error: {
        code: "E0412",
        file: "src/lib.rs",
        line: 9,
        column: 32,
        message: "cannot find type `Hello`",
      },
      log: "error[E0412]",
    };
    const FAILED_DEPLOY: RunResult = {
      act: "deploy",
      ok: false,
      seconds: 1,
      reason: "failed",
      message: "unused",
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
        expect(effects.at(-1)).toMatchObject({
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
            content: lib(ask.writes!.block),
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
          input: { beatId: "s1.build" },
          startedAt: 7000,
        });
        expect(reduce(ctx(), state, build(7100)).state).toBe(state);
      });

      it("refuses an act that the lesson has not reached", () => {
        const before = play([start]).state;
        expect(reduce(ctx(), before, build(7000)).state).toBe(before);
      });

      it("shows the stage while running and clears it when the run ends", () => {
        const running = play([
          start,
          rightPick,
          build(7000),
          {
            type: "stage",
            beatId: "s1.build",
            label: "Building",
            index: 1,
            count: 1,
            at: 7100,
          },
        ]).state;
        expect(running.stage).toEqual({
          beatId: "s1.build",
          label: "Building",
          index: 1,
          count: 1,
        });
        const ended = reduce(ctx(), running, {
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
        expect(r.effects).toEqual([]);
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
        expect(r.effects).toEqual([]);
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

      it("flows on after an ok act that is not the goal", () => {
        // Step 4: build and deploy, then the call
        const s4 = play([
          start,
          rightPick,
          build(7000),
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 8600 },
          { type: "next", at: 9000 },
          { type: "skip", beatId: "s2.q2", at: 9500 },
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
          beat: 4,
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
        expect(early.effects).toEqual([]);

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

      it("marks the planned failure on its run, never a build that could not run", () => {
        expect(failed().progress.runs["s1.build"]).toMatchObject([
          { status: "failed", planned: true },
        ]);
        const noCompiler: RunResult = {
          act: "build",
          ok: false,
          seconds: 0,
          error: null,
          log: "The build act is not wired yet.",
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
        expect(r.state).toBe(notPlanned);
        expect(r.effects).toEqual([
          { kind: "explain", beatId: "s1.build", result: noCompiler },
        ]);
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
        expect(r.state).toBe(s2);
        expect(r.effects).toEqual([
          { kind: "explain", beatId: "s2.deploy", result: FAILED_DEPLOY },
        ]);
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

      it("finish before the last win is a no-op", () => {
        const before = play(toFinish().slice(0, 4)).state;
        expect(reduce(ctx(), before, { type: "finish", at: 9000 }).state).toBe(
          before
        );
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
        const passed = run(
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
            passed
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
