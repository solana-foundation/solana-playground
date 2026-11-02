import type { Act, ConversationSave } from "@/entities/tutorial";

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
}

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
}

export type PassedVia = "chat" | "client" | "call_panel";

/**
 * A beat's state once the lesson has reached it. A `say` is `said`; a
 * `write` is `written` once the block landed; a question is `open` until a
 * right pick, the key line typed, Skip, or the step passing around it
 * (`pass`) resolves it; an act is `said`, its run living in `runs`.
 */
export type Resolution =
  | { kind: "said"; at: number; writeFailed?: true }
  | { kind: "written"; at: number; wrote: Wrote }
  | { kind: "open"; at: number; wrong: number[]; hintedAt?: number }
  | ({
      kind: "picked";
      option: number;
      /** 1 to 3: the right pick counts */
      attempts: number;
    } & Resolved)
  | ({ kind: "typed" } & Resolved)
  | ({ kind: "skipped"; via: SkipVia } & Resolved);

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
  /** The block the answer wrote, once it landed */
  wrote?: Wrote;
}

/** Lines a write took in a file, counted from 1; none for a created file */
export interface Wrote {
  file: string;
  lines: number[];
  created?: true;
}

/**
 * One act's run. `started` is what the save holds while the run is in
 * flight; a reload turns it into `interrupted` (`parseProgress`), since a
 * run never resumes and is never repeated by the engine.
 */
export type RunRecord =
  | { status: "started"; at: number }
  | { status: "interrupted"; at: number }
  | { status: "ok"; at: number; took: number; result: RunResult }
  | {
      status: "failed";
      at: number;
      took: number;
      result: RunResult;
      /** The failure the step plans, judged once when the run ended */
      planned?: true;
    };

/** The first compiler error of a failed build, as the server's log names it */
export interface BuildError {
  code: string | null;
  file: string | null;
  line: number | null;
  column: number | null;
  message: string;
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
      lamports: number;
      instructions: string[];
    }
  | {
      act: "deploy" | "buildDeploy";
      ok: false;
      seconds: number;
      reason: "failed" | "no_wallet" | "no_funds";
      message: string;
    }
  | {
      act: "run" | "call";
      ok: true;
      seconds: number;
      signatures: string[];
      /** The program log line the definition's pattern picked, if any */
      line: string | null;
    }
  | {
      act: "run" | "call";
      ok: false;
      seconds: number;
      message: string;
      log: string;
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
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isMs = (v: unknown): v is number => Number.isFinite(v);

const isMsOrNull = (v: unknown): v is number | null => v === null || isMs(v);

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");

const isIndexes = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((n) => Number.isInteger(n));

const ACTS: readonly Act[] = ["build", "deploy", "buildDeploy", "run", "call"];
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

const parseWrote = (v: unknown): Wrote | null => {
  if (!isRecord(v) || typeof v.file !== "string" || !isIndexes(v.lines)) {
    return null;
  }
  return v.created === true
    ? { file: v.file, lines: v.lines, created: true }
    : { file: v.file, lines: v.lines };
};

/** The fields every resolved question carries, or null when one is off */
const parseResolved = (v: Record<string, unknown>): Resolved | null => {
  if (!isMs(v.at) || !isMs(v.openedAt) || !isIndexes(v.wrong)) return null;
  const out: Resolved = { at: v.at, openedAt: v.openedAt, wrong: v.wrong };
  if (isMs(v.hintedAt)) out.hintedAt = v.hintedAt;
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
      if (isMs(v.hintedAt)) open.hintedAt = v.hintedAt;
      return open;
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

/**
 * A result is kept as it was saved once its act and `ok` are sound: the run
 * tickets own its other fields, and the cards read them by act.
 */
const parseResult = (v: unknown): RunResult | null =>
  isRecord(v) &&
  ACTS.includes(v.act as Act) &&
  typeof v.ok === "boolean" &&
  isMs(v.seconds)
    ? (v as unknown as RunResult)
    : null;

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
    case "failed": {
      const result = parseResult(v.result);
      if (!result || !isMs(v.took)) return null;
      return v.planned === true
        ? { status: "failed", at, took: v.took, result, planned: true }
        : { status: "failed", at, took: v.took, result };
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

const VIAS: readonly PassedVia[] = ["chat", "client", "call_panel"];

const parseTime = (v: unknown): StepTime | null => {
  if (!isRecord(v) || !isMs(v.from) || !isMsOrNull(v.to)) return null;
  const time: StepTime = { from: v.from, to: v.to };
  if (VIAS.includes(v.via as PassedVia)) time.via = v.via as PassedVia;
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
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/tutorial-conversation/model/progress", () => {
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
            },
          },
          "s2.q2": { kind: "open", at: 2000, wrong: [1], hintedAt: 2050 },
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
    });

    /** Through JSON, as the file holds it */
    const reload = (p: unknown) => parseProgress(JSON.parse(JSON.stringify(p)));

    it("parses a fresh save to itself", () => {
      expect(reload(freshProgress())).toEqual(freshProgress());
    });

    it("parses a midway save to itself", () => {
      expect(reload(midway())).toEqual(midway());
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

    it("turns a started run into an interrupted one", () => {
      const saved = midway({
        runs: { "s2.deploy": [{ status: "started", at: 2100 }] },
      });
      expect(reload(saved)?.runs["s2.deploy"]).toEqual([
        { status: "interrupted", at: 2100 },
      ]);
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
