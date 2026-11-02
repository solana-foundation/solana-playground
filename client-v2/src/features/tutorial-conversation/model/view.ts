import type {
  Act,
  ActBeat,
  Ask,
  Beat,
  Chip,
  Quote,
  Step,
  Text,
  TutorialDefinition,
  Win,
} from "@/entities/tutorial";

import { FINISH_DELAY_MS } from "./clock";
import type {
  ConversationProgress,
  PassedVia,
  Resolution,
  RunRecord,
  RunResult,
  Wrote,
} from "./progress";
import type { EngineState, Stage } from "./reducer";

/**
 * The feed as a fold over the definition and the saved progress. The save
 * holds facts; every word here comes from the definition, so a fixed typo
 * shows on reload. The feed (task 3.3) renders these turns and nothing
 * else; the cards dispatch actions and never compute state of their own.
 */

/** The learner's pill when they ask for the hint */
export const STUCK = "I'm stuck";
/** The learner's pill on Explain */
export const EXPLAIN = "Explain the error";
/** The act card's line after a reload interrupted its run */
export const INTERRUPTED = "Interrupted by a reload. Run it again.";
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

/** How a resolved question reads in its record */
export type AskOutcome =
  | "first_try"
  | "retry"
  | "typed"
  | "skipped"
  | "call_panel";

export type ActState = "live" | "running" | "done" | "failed" | "interrupted";

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
    | { kind: "say"; beatId: string; text: Text; quote?: Quote }
    | { kind: "you"; text: string; code: boolean }
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
    | { kind: "finish"; chips: Chip[] }
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
  | "Ask about this step"
  | "Ask while it builds"
  | "Ask anything";

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

const outcomeOf = (r: Resolution): AskOutcome | null => {
  switch (r.kind) {
    case "picked":
      return r.attempts === 1 ? "first_try" : "retry";
    case "typed":
      return "typed";
    case "skipped":
      return r.via === "call_panel" ? "call_panel" : "skipped";
    default:
      return null;
  }
};

const attemptsOf = (r: Resolution): number => {
  if (r.kind === "picked") return r.attempts;
  if (r.kind === "open") return r.wrong.length;
  return 0;
};

const actStateOf = (run: RunRecord | undefined): ActState => {
  if (!run) return "live";
  if (run.status === "started") return "running";
  if (run.status === "ok") return "done";
  return run.status;
};

/**
 * The id of the act card to keep live when the cursor's step has not passed
 * and the last act the cursor went past ended well: the step's goal refused
 * the result, so the card is the way to try again. Null otherwise.
 */
const refusedAct = (
  definition: TutorialDefinition,
  p: ConversationProgress
): string | null => {
  const cursor = p.cursor;
  if (cursor.kind !== "step" || p.passed.includes(cursor.stepId)) return null;
  const step = definition.steps.find((s) => s.id === cursor.stepId);
  if (!step) return null;
  const beats = beatsOf(step, cursor.fail).slice(0, cursor.beat);
  const last = [...beats].reverse().find((b) => b.kind === "act");
  if (!last) return null;
  const runs = p.runs[last.id] ?? [];
  const run = runs.at(-1);
  if (!run || run.status !== "ok") return null;
  return runs.length === 1 ? last.id : `${last.id}:${runs.length - 1}`;
};

export const view = (
  definition: TutorialDefinition,
  state: EngineState,
  { now, loadedAt }: ViewOptions
): ConversationView => {
  const p = state.progress;
  const all: Turn[] = [];
  const turn = (t: Posted) =>
    all.push({ ...t, whole: t.at < loadedAt } as Turn);

  if (p.cursor.kind === "intro") {
    turn({ id: "intro", kind: "intro", step: null, at: 0 });
  }

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
            outcome: outcomeOf(r),
            attempts: attemptsOf(r),
          });
          if ("hintedAt" in r && r.hintedAt !== undefined) {
            turn({
              id: `you:hint:${b.id}`,
              kind: "you",
              step: step.id,
              at: r.hintedAt,
              text: STUCK,
              code: false,
            });
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
          if (runs.length === 0) {
            turn({
              id: b.id,
              kind: "act",
              step: step.id,
              at: r.at,
              beatId: b.id,
              act: b,
              state: "live",
              note: null,
              stage: null,
              took: null,
            });
          }
          runs.forEach((run, n) => {
            const isLast = n === runs.length - 1;
            const cardAt = n === 0 ? r.at : run.at;
            turn({
              id: n === 0 ? b.id : `${b.id}:${n}`,
              kind: "act",
              step: step.id,
              at: cardAt,
              beatId: b.id,
              act: b,
              state: actStateOf(run),
              note: run.status === "interrupted" ? INTERRUPTED : null,
              stage:
                isLast && state.stage?.beatId === b.id ? state.stage : null,
              took:
                run.status === "ok" || run.status === "failed"
                  ? run.took
                  : null,
            });
            if (run.status === "ok" || run.status === "failed") {
              const planned = run.status === "failed" && run.planned === true;
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
                // A planned failure closes once Explain or "I'll fix it
                // myself" entered `onFail`; any other failure waits on this
                // card while it is the act's latest run
                open:
                  run.status === "failed" &&
                  isLast &&
                  !done &&
                  !(planned && p.cursor.kind === "step" && p.cursor.fail),
              });
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
    });
  }

  // Construction order is the lesson's order; time only moves a turn that
  // genuinely came later, such as a hint after its question
  const ordered = all
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.at - b.t.at || a.i - b.i)
    .map(({ t }) => t);
  const turns = ordered.filter((t) => t.at <= now);
  const ahead = ordered.filter((t) => t.at > now);
  const nextAt = ahead.length ? ahead[0].at : null;

  const running = turns.find((t) => t.kind === "act" && t.state === "running");
  // After the finish nothing acts; before it, the latest card that does. An
  // act of a step already passed (from the Call panel) is a record, not a card
  // The last act the cursor passed whose latest run ended well without
  // passing the step (its result failed the goal): its card stays the one
  // to press, so the learner can run it again
  const refusedActId = refusedAct(definition, p);
  let live: Turn | null = null;
  if (p.cursor.kind !== "finished") {
    live =
      [...turns].reverse().find((t) => {
        if (t.kind === "win") return !t.done;
        if (t.kind === "act") {
          if (t.step !== null && p.passed.includes(t.step)) return false;
          if (t.state === "done") return t.id === refusedActId;
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
  if (p.cursor.kind === "finished") placeholder = "Ask anything";
  else if (running) placeholder = "Ask while it builds";

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
    let hello: TutorialDefinition;
    let reduce: typeof import("./reducer").reduce;
    let INITIAL: typeof import("./reducer").INITIAL_ENGINE_STATE;
    let TICK: number;
    beforeAll(async () => {
      hello = (await import("../../../tutorials/hello-anchor/tutorial.json"))
        .default as unknown as TutorialDefinition;
      ({ reduce, INITIAL_ENGINE_STATE: INITIAL } = await import("./reducer"));
      ({ TICK_MS: TICK } = await import("./clock"));
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
      seconds: 1.2,
      error: {
        code: "E0412",
        file: "src/lib.rs",
        line: 9,
        column: 32,
        message: "no Hello",
      },
      log: "error[E0412]",
    };
    const CALLED: RunResult = {
      act: "call",
      ok: true,
      seconds: 1,
      signatures: ["x"],
      line: null,
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
      expect(v.placeholder).toBe("Ask about this step");
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

    it("a planned failure posts an open result with the definition's line, then Explain's pill and the fix question", () => {
      const failed = view(hello, play(toFailed()), LATE);
      expect(failed.turns.find((t) => t.id === "s1.build")).toMatchObject({
        state: "failed",
        took: 1200,
      });
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

    it("an act whose ok result the goal refused stays the live card", () => {
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
      expect(v.turns.find((t) => t.id === "s1.build")).toMatchObject({
        state: "done",
      });
      expect(v.live?.id).toBe("s1.build");
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
      expect(view(hello, state, LATE).live?.id).toBe("s1.build:1");
    });

    it("a run again keeps the first result as a record and posts a second card", () => {
      const state = play(
        toFailed().concat([
          { type: "act", beatId: "s1.build", at: 9000 },
          { type: "ended", beatId: "s1.build", result: OK_BUILD, at: 10600 },
        ])
      );
      const v = view(hello, state, LATE);
      expect(ids(v).slice(-5)).toEqual([
        "s1.build",
        "result:s1.build:0",
        "s1.build:1",
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

    it("an interrupted run is the live act again", () => {
      const state = play(toFailed().slice(0, 3));
      const interrupted: EngineState = {
        progress: {
          version: 1,
          passed: state.progress.passed,
          finishedAt: null,
          startedAt: state.progress.startedAt,
          restartedAt: null,
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
