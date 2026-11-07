/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { Idl } from "@coral-xyz/anchor";

import type { Act, Goal } from "@/entities/tutorial";

import type { RunResult, UnreadTx } from "./progress";

/**
 * The engine's three doors to the world. The reducer never touches them: it
 * queues effects, and `PgConversation` drains the queue through these. The
 * in-memory ones below let the whole engine run in a unit test.
 */

/**
 * The tutorial workspace's files, by path relative to the workspace.
 * `workspace` names the workspace the effect was queued for: the real port
 * refuses to touch any other, so a switch while a write is in flight
 * never lands the block in the next project.
 */
export interface Workspace {
  /** @returns the file's content, or null when there is no such file */
  read(path: string, workspace: string): Promise<string | null>;
  /** Writes the whole file, creating it when needed */
  write(path: string, content: string, workspace: string): Promise<void>;
  /** Removes the file; nothing to do when there is none */
  remove(path: string, workspace: string): Promise<void>;
}

export interface RunInput {
  /** The act beat's id, so a result can be matched to its run */
  beatId: string;
  /**
   * A build's step names this line for its planned failure: the runner shows
   * the error that holds it. Absent inside the planned failure's own beats
   */
  failsWith?: string;
  /**
   * A call act's instruction, the argument values the learner gave and the
   * addresses earlier calls wrote to, by IDL name
   */
  call?: {
    instruction: string;
    args: Record<string, string>;
    accounts?: Record<string, string>;
  };
  /**
   * The IDL of the deployed program, which a call is encoded with and every
   * transaction is decoded by. Absent before a deploy: the last build's then.
   */
  idl?: Idl;
  /**
   * The step's `call` goal's log pattern: a run or call picks its card's
   * large line with it, so the line the card shows is the one the goal
   * judges. Absent when the goal names none.
   */
  log?: string;
  /** The account the act draws: read from the chain once the run landed */
  account?: string;
  /**
   * "Check again" on an unconfirmed run or call: the transactions it sent, to
   * read from devnet again. Nothing is funded or sent.
   */
  recheck?: UnreadTx[];
}

/** One stage of a run as it starts: its label, and "n of m" */
export interface RunStage {
  label: string;
  /** 1-based */
  index: number;
  count: number;
}

/**
 * Runs one act and reports its stages as they start ("Building",
 * "Writing buffer", ...). The result is a fact, never a throw: a run that
 * could not happen is `ok: false` with its reason. The run tickets provide
 * the real one.
 */
export interface Runner {
  run(
    act: Act,
    input: RunInput,
    onStage: (stage: RunStage) => void
  ): Promise<RunResult>;
  /**
   * A run a reload interrupted, looked up where it would have landed: the
   * result it had, or null when it did not land or the act cannot tell
   * (only a deploy can, from the chain). `startedAtMs` is the interrupted
   * run's `at`: its start by the device's clock, in ms
   */
  recognise?(act: Act, startedAtMs: number): Promise<RunResult | null>;
}

/**
 * A run that could not happen, as that act's failed result. A build's is
 * `unreachable`: no answer, or no output of its own, reached the browser,
 * and its card offers Try again
 */
export const failedResult = (
  act: Act,
  message: string,
  seconds = 0
): RunResult => {
  switch (act) {
    case "build":
      return {
        act,
        ok: false,
        seconds,
        reason: "unreachable",
        error: null,
        log: message,
      };
    case "deploy":
    case "buildDeploy":
      return { act, ok: false, seconds, reason: "failed", message };
    case "run":
    case "call":
      return { act, ok: false, seconds, message, log: "" };
  }
};

/**
 * A runner for a test or a storybook that has none: every act fails with a
 * message that says so. Never the store's default, so a frame that forgets
 * its runner fails to compile rather than ship a lesson whose every act
 * fails with "not wired".
 */
export const unwiredRunner: Runner = {
  run: async (act) => failedResult(act, `The ${act} act is not wired yet.`),
};

/** Whether a run's result passes a step's goal; `judgeGoal` is the real one */
export type Judge = (goal: Goal, result: RunResult) => boolean;

/** An in-memory workspace, for tests. `files` is live: read it after a write */
export const memoryWorkspace = (
  initial: Record<string, string> = {}
): Workspace & { files: Record<string, string> } => {
  const files = { ...initial };
  return {
    files,
    read: async (path) => (path in files ? files[path] : null),
    write: async (path, content) => {
      files[path] = content;
    },
    remove: async (path) => {
      delete files[path];
    },
  };
};

/**
 * A runner that answers from a script, for tests: each run takes the next
 * entry, reporting its stages first. A run past the script's end rejects, so
 * a test that runs more than it planned fails loudly.
 */
export const stubRunner = (
  script: { stages?: string[]; result: RunResult }[]
): Runner & { runs: { act: Act; input: RunInput }[] } => {
  const queue = [...script];
  const runs: { act: Act; input: RunInput }[] = [];
  return {
    runs,
    run: async (act, input, onStage) => {
      runs.push({ act, input });
      const next = queue.shift();
      if (!next) throw new Error(`stubRunner: no result scripted for ${act}`);
      const stages = next.stages ?? [];
      stages.forEach((label, i) =>
        onStage({ label, index: i + 1, count: stages.length })
      );
      return next.result;
    },
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/tutorial-conversation/model/ports", () => {
    it("memoryWorkspace reads what was written and null otherwise", async () => {
      const ws = memoryWorkspace({ "src/lib.rs": "" });
      expect(await ws.read("src/lib.rs", "x")).toBe("");
      expect(await ws.read("client/client.ts", "x")).toBeNull();
      await ws.write("client/client.ts", "// hi", "x");
      expect(ws.files["client/client.ts"]).toBe("// hi");
      await ws.remove("client/client.ts", "x");
      await ws.remove("never/there.ts", "x");
      expect(ws.files).toEqual({ "src/lib.rs": "" });
    });

    it("stubRunner reports the stages, answers in order and refuses past the script", async () => {
      const ok: RunResult = {
        act: "build",
        ok: true,
        seconds: 1,
        instructions: [],
      };
      const runner = stubRunner([{ stages: ["Building"], result: ok }]);
      const stages: RunStage[] = [];
      await expect(
        runner.run("build", { beatId: "s1.build" }, (s) => stages.push(s))
      ).resolves.toBe(ok);
      expect(stages).toEqual([{ label: "Building", index: 1, count: 1 }]);
      expect(runner.runs).toEqual([
        { act: "build", input: { beatId: "s1.build" } },
      ]);
      await expect(
        runner.run("build", { beatId: "f1.build" }, () => {})
      ).rejects.toThrow("no result scripted");
    });

    it("failedResult shapes a failure for each act, and the unwired runner answers with one", async () => {
      expect(failedResult("build", "down")).toEqual({
        act: "build",
        ok: false,
        seconds: 0,
        reason: "unreachable",
        error: null,
        log: "down",
      });
      expect(failedResult("deploy", "down")).toMatchObject({
        reason: "failed",
        message: "down",
      });
      expect(failedResult("call", "down")).toMatchObject({ message: "down" });
      await expect(
        unwiredRunner.run("run", { beatId: "x" }, () => {})
      ).resolves.toMatchObject({ ok: false });
    });
  });
}
