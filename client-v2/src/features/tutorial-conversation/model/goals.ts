/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { Goal } from "@/entities/tutorial";
import { sameIdlName } from "@/shared/lib/idl-name";
import { createLogger } from "@/shared/lib/logger";

import type { Judge } from "./ports";
import type { Called, RunResult } from "./progress";
import { existsOf } from "./progress";

const goalsLog = createLogger("tutorial-conversation:goals");

/**
 * Whether a run's result passes a step's goal: the real check, so no step
 * passes on the learner's word. The same goal is passed by an act card, a
 * client run and a Call panel call, since all three end in a `RunResult`.
 *
 * - `build`: a build (or the build of a build-and-deploy) that succeeded and
 *   whose IDL holds every instruction the goal names.
 * - `deploy`: a deploy that landed.
 * - `call`: a confirmed call of the goal's instruction carrying every
 *   argument the goal requires, each with a non-blank value, and, when the
 *   goal has a `log` pattern, a picked log line that matches it (no line
 *   fails). Arguments are read from what the
 *   deployed program decoded, which is what keeps a call before the upgrade
 *   from passing step 4: its log `Hello, World!` matches `Hello, .+!` too.
 *   A goal with `creates` also passes on a failed run or call whose
 *   `exists` names the goal's instruction and that account.
 * - `refused`: a run or call the program refused in the goal's instruction,
 *   matching the goal's error if it names one (each of its name and code
 *   given) and the goal's log pattern over the whole transaction log if it
 *   gives one; both when both are given. A failure that never reached the
 *   program carries no refusal and passes nothing.
 */
export const judgeGoal: Judge = (goal, result) => {
  if (goal.kind === "refused") return refusalMeets(goal, result);
  if (goal.kind === "call" && !result.ok) return existsMeets(goal, result);
  if (!result.ok) return false;
  switch (goal.kind) {
    case "build":
      return (
        (result.act === "build" || result.act === "buildDeploy") &&
        (goal.instructions ?? []).every((name) =>
          result.instructions.some((held) => sameIdlName(held, name))
        )
      );
    case "deploy":
      return result.act === "deploy" || result.act === "buildDeploy";
    case "call":
      return (
        (result.act === "run" || result.act === "call") &&
        result.called.some((c) => callMeets(goal, c)) &&
        (goal.log === undefined || logMatches(goal.log, result.line))
      );
    default: {
      // The loader drops a definition that fails `tutorial:check`, so a kind
      // this client does not know is a definition that skipped it
      const unknown: never = goal;
      goalsLog.error("a step goal of a kind this client does not judge", {
        report: true,
        context: { goal: unknown },
      });
      return false;
    }
  }
};

type CallGoal = Extract<Goal, { kind: "call" }>;
type RefusedGoal = Extract<Goal, { kind: "refused" }>;

/** The program refused the goal's instruction the way the goal names */
const refusalMeets = (goal: RefusedGoal, result: RunResult): boolean => {
  if (result.ok || (result.act !== "run" && result.act !== "call")) {
    return false;
  }
  const { refused } = result;
  if (!refused || !sameIdlName(refused.instruction, goal.instruction)) {
    return false;
  }
  if (goal.error) {
    const { name, code } = goal.error;
    if (!refused.error) return false;
    if (code !== undefined && refused.error.code !== code) return false;
    if (name !== undefined && refused.error.name !== name) return false;
  }
  return goal.log === undefined || logMatches(goal.log, result.log);
};

/** The account the goal's instruction creates was already there */
const existsMeets = (goal: CallGoal, result: RunResult): boolean => {
  const exists = existsOf(result);
  return (
    goal.creates !== undefined &&
    exists !== undefined &&
    sameIdlName(exists.instruction, goal.instruction) &&
    sameIdlName(exists.account, goal.creates)
  );
};

/** The call names the goal's instruction and carries each required argument, non-blank */
const callMeets = (goal: CallGoal, called: Called): boolean =>
  sameIdlName(called.instruction, goal.instruction) &&
  (goal.args ?? []).every((arg) =>
    Object.entries(called.args).some(
      ([name, value]) => sameIdlName(name, arg) && value.trim() !== ""
    )
  );

/** Which part of a step's goal a landed run missed, as far as it can be told */
export type GoalGap =
  | { kind: "noInstruction"; instruction: string }
  | { kind: "notCalled"; instruction: string }
  | { kind: "logDiffers"; instruction: string }
  /** A call to the program did not decode: the code no longer matches the step */
  | { kind: "mismatch" }
  | { kind: "other" };

/**
 * Why `judgeGoal` turned a landed run down. Any case not told apart for certain
 * is `other`: the learner reads this, so it never guesses.
 */
export const goalGap = (goal: Goal, result: RunResult): GoalGap => {
  if (!result.ok) return { kind: "other" };
  if (
    goal.kind === "build" &&
    (result.act === "build" || result.act === "buildDeploy")
  ) {
    const missing = (goal.instructions ?? []).find(
      (name) => !result.instructions.some((held) => sameIdlName(held, name))
    );
    return missing
      ? { kind: "noInstruction", instruction: missing }
      : { kind: "other" };
  }
  if (goal.kind === "call" && (result.act === "run" || result.act === "call")) {
    const { instruction } = goal;
    const called = result.called.some((c) =>
      sameIdlName(c.instruction, instruction)
    );
    // An instruction to the program that the step's IDL does not decode may
    // be the one the goal names, called under another name or shape: the
    // learner's code and the step no longer agree, which is the one thing
    // that can be said, so it is said instead of "not called"
    if (!called) {
      return result.undecoded
        ? { kind: "mismatch" }
        : { kind: "notCalled", instruction };
    }
    // No line at all is not a different line, so it isn't called one
    if (
      goal.log !== undefined &&
      result.line !== null &&
      result.called.some((c) => callMeets(goal, c)) &&
      !logMatches(goal.log, result.line)
    ) {
      return { kind: "logDiffers", instruction };
    }
  }
  return { kind: "other" };
};

/** Patterns already reported as broken, so a learner's retries report once */
const reported = new Set<string>();

/**
 * Unanchored and case-blind, as `tutorial.schema.json`'s `pattern` says and
 * `compiles` in the definition check reads it
 */
const logMatches = (pattern: string, line: string | null): boolean => {
  if (line === null) return false;
  try {
    return new RegExp(pattern, "i").test(line);
  } catch (e) {
    // `tutorial:check` rejects such a pattern, so one here is a definition
    // that skipped the check: the step cannot pass, and the team must hear
    // of it once
    if (!reported.has(pattern)) {
      reported.add(pattern);
      goalsLog.error(e, { report: true, context: { pattern } });
    }
    return false;
  }
};

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll, beforeEach, afterEach } = import.meta
    .vitest;
  type Refusal = import("./progress").Refusal;

  // Hello Anchor's four goals, as its `tutorial.json` writes them
  const BUILD_HELLO: Goal = { kind: "build", instructions: ["hello"] };
  const DEPLOY: Goal = { kind: "deploy" };
  const CALL_HELLO: Goal = {
    kind: "call",
    instruction: "hello",
    log: "Hello, World!",
  };
  const GREET_BY_NAME: Goal = {
    kind: "call",
    instruction: "hello",
    args: ["name"],
    log: "Hello, .+!",
  };

  const built = (instructions: string[]): RunResult => ({
    act: "build",
    ok: true,
    seconds: 1,
    instructions,
  });
  const deployed = (act: "deploy" | "buildDeploy"): RunResult => ({
    act,
    ok: true,
    seconds: 3,
    programId: "Prog111",
    signature: "sig",
    upgraded: act === "buildDeploy",
    lamports: 1_500_000,
    instructions: ["hello"],
  });
  const ran = (
    act: "run" | "call",
    called: Called[],
    line: string | null
  ): RunResult => ({
    act,
    ok: true,
    seconds: 1,
    signatures: ["sig"],
    line,
    called,
  });
  const hello = (args: Record<string, string>): Called => ({
    instruction: "hello",
    args,
  });

  describe("features/tutorial-conversation/model/goals", () => {
    let logger: typeof import("@/shared/lib/logger");
    let logged: ReturnType<typeof import("@/shared/lib/logger").memoryProvider>;
    const errors = () => logged.entries.filter((e) => e.level === "error");

    beforeAll(async () => {
      logger = await import("@/shared/lib/logger");
    });
    beforeEach(() => {
      logged = logger.memoryProvider();
      logger.initLogger({ providers: [logged] });
    });
    afterEach(() => logger.resetLogger());

    describe("goalGap", () => {
      const LOG_HELLO: Goal = {
        kind: "call",
        instruction: "hello",
        log: "Hello, World!",
      };

      it("names the instruction a build's IDL lacks", () => {
        expect(goalGap(BUILD_HELLO, built([]))).toEqual({
          kind: "noInstruction",
          instruction: "hello",
        });
      });

      it("says a run did not call the goal's instruction", () => {
        expect(goalGap(LOG_HELLO, ran("run", [], null))).toEqual({
          kind: "notCalled",
          instruction: "hello",
        });
      });

      it("says the code no longer matches when an instruction did not decode", () => {
        const undecoded = Object.assign(ran("run", [], null), {
          undecoded: true,
        });
        expect(goalGap(LOG_HELLO, undecoded)).toEqual({ kind: "mismatch" });
      });

      it("says the call landed with another log", () => {
        expect(
          goalGap(LOG_HELLO, ran("run", [hello({})], "Hello, Mars!"))
        ).toEqual({ kind: "logDiffers", instruction: "hello" });
      });

      it("does not call a missing log line a different one", () => {
        expect(goalGap(LOG_HELLO, ran("run", [hello({})], null))).toEqual({
          kind: "other",
        });
      });

      it("names a gap only where the judge refused", () => {
        expect(judgeGoal(BUILD_HELLO, built([]))).toBe(false);
        expect(judgeGoal(LOG_HELLO, ran("run", [], null))).toBe(false);
        expect(
          judgeGoal(LOG_HELLO, ran("run", [hello({})], "Hello, Mars!"))
        ).toBe(false);
      });

      it("does not guess at a call that lacks the goal's argument", () => {
        const byName: Goal = {
          kind: "call",
          instruction: "hello",
          args: ["name"],
          log: "Hello, .+!",
        };
        expect(goalGap(byName, ran("call", [hello({})], "Hi"))).toEqual({
          kind: "other",
        });
      });

      it("has nothing to say about a failed run or another act", () => {
        expect(goalGap(LOG_HELLO, built([]))).toEqual({ kind: "other" });
        expect(
          goalGap(BUILD_HELLO, {
            act: "build",
            ok: false,
            seconds: 1,
            reason: "unreachable",
            error: null,
            log: "",
          })
        ).toEqual({ kind: "other" });
      });
    });

    describe("build", () => {
      it("passes a build whose IDL holds the goal's instructions", () => {
        expect(judgeGoal(BUILD_HELLO, built(["hello"]))).toBe(true);
        expect(judgeGoal({ kind: "build" }, built([]))).toBe(true);
      });

      it("passes the build of a build-and-deploy", () => {
        expect(judgeGoal(BUILD_HELLO, deployed("buildDeploy"))).toBe(true);
      });

      it("fails a build missing an instruction, a failed build and another act", () => {
        expect(judgeGoal(BUILD_HELLO, built([]))).toBe(false);
        expect(
          judgeGoal(BUILD_HELLO, {
            act: "build",
            ok: false,
            reason: "compiler",
            seconds: 1,
            error: null,
            log: "error[E0412]",
          })
        ).toBe(false);
        expect(judgeGoal(BUILD_HELLO, deployed("deploy"))).toBe(false);
        expect(
          judgeGoal(BUILD_HELLO, ran("call", [hello({})], "Hello, World!"))
        ).toBe(false);
      });

      it("needs every instruction the goal names", () => {
        const goal: Goal = { kind: "build", instructions: ["hello", "bye"] };
        expect(judgeGoal(goal, built(["hello"]))).toBe(false);
        expect(judgeGoal(goal, built(["bye", "hello"]))).toBe(true);
      });

      it("matches an instruction across snake and camel spelling", () => {
        expect(
          judgeGoal(
            { kind: "build", instructions: ["greet_by_name"] },
            built(["greetByName"])
          )
        ).toBe(true);
      });
    });

    describe("deploy", () => {
      it("passes a deploy or a build-and-deploy that landed", () => {
        expect(judgeGoal(DEPLOY, deployed("deploy"))).toBe(true);
        expect(judgeGoal(DEPLOY, deployed("buildDeploy"))).toBe(true);
      });

      it("fails a deploy that did not land, and a build", () => {
        expect(
          judgeGoal(DEPLOY, {
            act: "deploy",
            ok: false,
            seconds: 1,
            reason: "no_funds",
            message: "Not enough devnet SOL",
            balance: 0,
            cost: 1_500_000_000,
            address: "11111111111111111111111111111111",
          })
        ).toBe(false);
        expect(judgeGoal(DEPLOY, built(["hello"]))).toBe(false);
      });
    });

    describe("call", () => {
      it("passes step 3 from a client run, a call act and the Call panel alike", () => {
        const line = "Program log: Hello, World!";
        expect(judgeGoal(CALL_HELLO, ran("run", [hello({})], line))).toBe(true);
        expect(judgeGoal(CALL_HELLO, ran("call", [hello({})], line))).toBe(
          true
        );
      });

      it("fails a call with no log line, another instruction, or a failed transaction", () => {
        expect(judgeGoal(CALL_HELLO, ran("run", [hello({})], null))).toBe(
          false
        );
        expect(
          judgeGoal(
            CALL_HELLO,
            ran(
              "run",
              [{ instruction: "initialize", args: {} }],
              "Program log: Hello, World!"
            )
          )
        ).toBe(false);
        expect(
          judgeGoal(CALL_HELLO, {
            act: "run",
            ok: false,
            seconds: 1,
            message: "Transaction failed",
            log: "",
          })
        ).toBe(false);
        expect(judgeGoal(CALL_HELLO, deployed("deploy"))).toBe(false);
      });

      it("a call before the upgrade does not pass the argument goal", () => {
        // The deployed `hello` takes no `name` yet, so none is decoded, while
        // its log still matches step 4's pattern
        expect(
          judgeGoal(
            GREET_BY_NAME,
            ran("call", [hello({})], "Program log: Hello, World!")
          )
        ).toBe(false);
      });

      it("passes step 4 once the upgraded program takes a non-blank name", () => {
        expect(
          judgeGoal(
            GREET_BY_NAME,
            ran("call", [hello({ name: "Alex" })], "Program log: Hello, Alex!")
          )
        ).toBe(true);
        expect(
          judgeGoal(
            GREET_BY_NAME,
            ran("call", [hello({ name: "  " })], "Program log: Hello,   !")
          )
        ).toBe(false);
      });

      it("finds the goal's call among several, and matches names across camelCase", () => {
        expect(
          judgeGoal(
            { kind: "call", instruction: "greet_by_name", args: ["user_name"] },
            ran(
              "run",
              [
                { instruction: "initialize", args: {} },
                { instruction: "greetByName", args: { userName: "Alex" } },
              ],
              null
            )
          )
        ).toBe(true);
      });

      it("needs every required argument, each non-blank", () => {
        const goal: Goal = {
          kind: "call",
          instruction: "hello",
          args: ["name", "greeting"],
        };
        expect(
          judgeGoal(goal, ran("call", [hello({ name: "Alex" })], null))
        ).toBe(false);
        expect(
          judgeGoal(
            goal,
            ran("call", [hello({ name: "Alex", greeting: "" })], null)
          )
        ).toBe(false);
        expect(
          judgeGoal(
            goal,
            ran("call", [hello({ name: "Alex", greeting: "Hi" })], null)
          )
        ).toBe(true);
      });

      it("anchors `^` to the whole picked line, its `Program log: ` included", () => {
        const line = "Program log: Hello, World!";
        const anchored = (log: string): Goal => ({
          kind: "call",
          instruction: "hello",
          log,
        });
        expect(
          judgeGoal(anchored("^Hello"), ran("run", [hello({})], line))
        ).toBe(false);
        expect(
          judgeGoal(
            anchored("^Program log: Hello, World!$"),
            ran("run", [hello({})], line)
          )
        ).toBe(true);
      });

      it("matches the log pattern without regard to case, as the schema says", () => {
        expect(
          judgeGoal(
            CALL_HELLO,
            ran("run", [hello({})], "Program log: hello, world!")
          )
        ).toBe(true);
      });

      it("fails, without throwing, a pattern that is not a regular expression, and reports it once", () => {
        const goal: Goal = { kind: "call", instruction: "hello", log: "(" };
        expect(judgeGoal(goal, ran("call", [hello({})], "("))).toBe(false);
        expect(judgeGoal(goal, ran("call", [hello({})], "("))).toBe(false);
        expect(errors()).toHaveLength(1);
      });
    });

    describe("judgeGoal", () => {
      // Lumberjack's step 2 (HOO-2362)
      const CREATE_PLAYER: Goal = {
        kind: "call",
        instruction: "init_player",
        creates: "player",
      };
      const failedWith = (
        exists: import("./progress").Exists | undefined
      ): RunResult =>
        exists
          ? {
              act: "call",
              ok: false,
              seconds: 1,
              message: "custom program error: 0x0",
              log: "",
              refused: {
                instruction: "initPlayer",
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
                instruction: "initPlayer",
                error: { code: 0, name: null },
              },
            };
      const PLAYER = {
        instruction: "init_player",
        account: "player",
        address: "Player1",
      };

      it("passes a goal with creates when its account already exists", () => {
        expect(judgeGoal(CREATE_PLAYER, failedWith(PLAYER))).toBe(true);
      });

      it("fails a goal with creates on a call refused for another reason", () => {
        expect(judgeGoal(CREATE_PLAYER, failedWith(undefined))).toBe(false);
      });

      it("fails a goal without creates on an existing account", () => {
        expect(
          judgeGoal(
            { kind: "call", instruction: "init_player" },
            failedWith(PLAYER)
          )
        ).toBe(false);
      });
    });

    describe("refused", () => {
      // Lumberjack's step 3 and Zero Copy's step 2, as their scripts end
      const OUT_OF_ENERGY: Goal = {
        kind: "refused",
        instruction: "chop_tree",
        error: { name: "NotEnoughEnergy", code: 6000 },
      };
      const OUT_OF_MEMORY: Goal = {
        kind: "refused",
        instruction: "grow",
        log: "out of memory",
      };

      const refusedBy = (
        act: "run" | "call",
        refused: Refusal | undefined,
        log = ""
      ): RunResult =>
        refused
          ? { act, ok: false, seconds: 1, message: "refused", log, refused }
          : { act, ok: false, seconds: 1, message: "No wallet", log };
      const chop = (code: number, name: string | null): Refusal => ({
        instruction: "chop_tree",
        error: { code, name },
      });

      it("passes a refusal with the goal's error, from a call act or a client run", () => {
        expect(
          judgeGoal(
            OUT_OF_ENERGY,
            refusedBy("call", chop(6000, "NotEnoughEnergy"))
          )
        ).toBe(true);
        expect(
          judgeGoal(
            OUT_OF_ENERGY,
            refusedBy("run", chop(6000, "NotEnoughEnergy"))
          )
        ).toBe(true);
      });

      it("checks each of the name and the code the goal gives", () => {
        const byCode: Goal = {
          kind: "refused",
          instruction: "chop_tree",
          error: { code: 6000 },
        };
        const byName: Goal = {
          kind: "refused",
          instruction: "chop_tree",
          error: { name: "NotEnoughEnergy" },
        };
        expect(judgeGoal(byCode, refusedBy("call", chop(6000, null)))).toBe(
          true
        );
        expect(
          judgeGoal(byName, refusedBy("call", chop(6001, "NotEnoughEnergy")))
        ).toBe(true);
        expect(
          judgeGoal(
            OUT_OF_ENERGY,
            refusedBy("call", chop(6001, "NotEnoughEnergy"))
          )
        ).toBe(false);
        expect(
          judgeGoal(OUT_OF_ENERGY, refusedBy("call", chop(6000, "NoWood")))
        ).toBe(false);
        expect(
          judgeGoal(
            OUT_OF_ENERGY,
            refusedBy("call", { instruction: "chop_tree", error: null })
          )
        ).toBe(false);
      });

      it("fails another instruction, a confirmed call, and a failure that never reached the program", () => {
        expect(
          judgeGoal(
            OUT_OF_ENERGY,
            refusedBy("call", {
              instruction: "init_player",
              error: { code: 6000, name: "NotEnoughEnergy" },
            })
          )
        ).toBe(false);
        expect(
          judgeGoal(
            OUT_OF_ENERGY,
            ran("call", [{ instruction: "chop_tree", args: {} }], null)
          )
        ).toBe(false);
        expect(judgeGoal(OUT_OF_ENERGY, refusedBy("call", undefined))).toBe(
          false
        );
        expect(judgeGoal(OUT_OF_ENERGY, built(["chop_tree"]))).toBe(false);
      });

      it("matches the log pattern over the whole transaction log: out of memory, not too big", () => {
        const grow: Refusal = { instruction: "grow", error: null };
        const tooBig = [
          "Program Zero111 invoke [1]",
          "Program log: Error: an account can grow by at most 10,240 bytes in one instruction",
          "Program Zero111 failed: Failed to reallocate account data",
        ].join("\n");
        const outOfMemory = [
          "Program Zero111 invoke [1]",
          "Program log: Error: memory allocation failed, OUT OF MEMORY",
          "Program Zero111 failed: SBF program panicked",
        ].join("\n");
        expect(judgeGoal(OUT_OF_MEMORY, refusedBy("call", grow, tooBig))).toBe(
          false
        );
        expect(
          judgeGoal(OUT_OF_MEMORY, refusedBy("call", grow, outOfMemory))
        ).toBe(true);
      });

      it("needs both the error and the log when the goal gives both", () => {
        const both: Goal = {
          kind: "refused",
          instruction: "chop_tree",
          error: { code: 6000 },
          log: "Not enough energy",
        };
        const refusal = chop(6000, "NotEnoughEnergy");
        expect(judgeGoal(both, refusedBy("call", refusal, ""))).toBe(false);
        expect(
          judgeGoal(
            both,
            refusedBy(
              "call",
              refusal,
              "Program log: AnchorError ... Error Message: Not enough energy."
            )
          )
        ).toBe(true);
      });

      it("a refusal passes no call goal", () => {
        expect(
          judgeGoal(
            { kind: "call", instruction: "chop_tree" },
            refusedBy("call", chop(6000, "NotEnoughEnergy"))
          )
        ).toBe(false);
      });
    });

    it("fails, and reports, a goal of a kind it does not know", () => {
      const unknown = { kind: "read" } as unknown as Goal;
      expect(judgeGoal(unknown, built(["hello"]))).toBe(false);
      expect(errors()).toHaveLength(1);
    });
  });
}
