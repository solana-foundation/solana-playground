import type { StageStatus } from "@/views/flow/state/stage";

import type { TerminalReason } from "./telemetry";

/** A run's verdict, the one the terminal bar last has to speak for */
export type LastRun =
  | { kind: "build"; ok: true; instructions: string[] }
  | { kind: "build"; ok: false; line: number | null }
  | { kind: "deploy"; ok: boolean };

export interface TerminalFacts {
  /** What runs now, if anything */
  running: "build" | "deploy" | null;
  /** The newest finished run, or null before anything ran */
  last: LastRun | null;
  /**
   * The file edited since the last good deploy (its base name), or null:
   * the deploy no longer speaks for the code
   */
  changed: string | null;
}

/** The bar's dot: the design system's `StatusDot` variants it uses */
export type TerminalTone = "idle" | "running" | "success" | "warning" | "error";

export interface TerminalStatus {
  text: string;
  tone: TerminalTone;
}

/** The drawer's line before anything ran */
export const NOTHING_RUN =
  "Nothing run yet. Builds, deploys and calls print here.";

/** "IDL: 1 instruction · hello", the way a good build names what it made */
const idlLine = (instructions: string[]) => {
  const count = `${instructions.length} instruction${
    instructions.length === 1 ? "" : "s"
  }`;
  return [`IDL: ${count}`, ...instructions].join(" · ");
};

const lastText = (last: LastRun): TerminalStatus => {
  if (last.kind === "deploy") {
    return last.ok
      ? { text: "Deployed", tone: "success" }
      : { text: "Deploy failed", tone: "error" };
  }
  if (!last.ok) {
    return {
      text:
        last.line === null
          ? "Build failed"
          : `Build failed · line ${last.line}`,
      tone: "error",
    };
  }
  return {
    text: `Build successful · ${idlLine(last.instructions)}`,
    tone: "success",
  };
};

/**
 * The terminal bar's one line: a run in flight, then a file edited past the
 * last good deploy (amber: the deploy no longer speaks for the code), then
 * the newest run's verdict, then "Ready".
 */
export const terminalStatus = ({
  running,
  last,
  changed,
}: TerminalFacts): TerminalStatus => {
  if (running === "build") return { text: "Building", tone: "running" };
  if (running === "deploy") return { text: "Deploying", tone: "running" };
  if (changed !== null && last?.kind === "deploy" && last.ok) {
    return {
      text: `${changed} changed since the last deploy`,
      tone: "warning",
    };
  }
  if (last === null) return { text: "Ready", tone: "idle" };
  return lastText(last);
};

/** The two stage statuses the bar and the auto-open read, as `PgFlow` has them */
export interface RunStates {
  build: StageStatus;
  deploy: StageStatus;
}

/** Nothing has run in this workspace, or `PgFlow` was reset for another one */
const isFresh = (s: RunStates) =>
  s.build === "upcoming" && s.deploy === "upcoming";

/** What the build output says when a verdict is read, for `stepFacts` */
export interface Verdicts {
  /** The failed build's first diagnostic line, if the output names one */
  failedLine: number | null;
  /** The instruction names of the IDL the last good build made */
  instructions: string[];
}

/** What finished between two states, or null when nothing did */
const finished = (
  prev: RunStates,
  next: RunStates,
  read: Verdicts
): LastRun | null => {
  if (prev.build === "running" && next.build !== "running") {
    return next.build === "failed"
      ? { kind: "build", ok: false, line: read.failedLine }
      : { kind: "build", ok: true, instructions: read.instructions };
  }
  if (prev.deploy === "running" && next.deploy !== "running") {
    return { kind: "deploy", ok: next.deploy === "done" };
  }
  return null;
};

/** What a reload knows: the workspace's record, read back by `PgFlow` */
export const restoredRun = (s: RunStates, read: Verdicts): LastRun | null => {
  if (s.deploy === "done") return { kind: "deploy", ok: true };
  if (s.build === "failed") {
    return { kind: "build", ok: false, line: read.failedLine };
  }
  if (s.build === "done") {
    return { kind: "build", ok: true, instructions: read.instructions };
  }
  return null;
};

export interface Step {
  facts: TerminalFacts;
  /**
   * What the deployed copy of the files does now: `take` a fresh one (a good
   * deploy landed), `drop` it (the workspace was reset), or `keep` it
   */
  deployed: "take" | "drop" | "keep";
}

/**
 * The bar's facts after `PgFlow` moved from `prev` to `next`: a run that
 * finished becomes the verdict, a reset clears it, and a workspace's record
 * read back (`restore`) stands in for a verdict this visit never saw.
 * `changed` is left as it was; the caller recomputes it against the
 * deployed copy, which only it can read.
 */
export const stepFacts = (
  facts: TerminalFacts,
  prev: RunStates,
  next: RunStates,
  read: Verdicts
): Step => {
  let running: TerminalFacts["running"] = null;
  if (next.build === "running") running = "build";
  else if (next.deploy === "running") running = "deploy";
  const done = finished(prev, next, read);
  if (done) {
    return {
      facts: { running, last: done, changed: facts.changed },
      deployed: done.kind === "deploy" && done.ok ? "take" : "keep",
    };
  }
  if (isFresh(next)) {
    return { facts: { running, last: null, changed: null }, deployed: "drop" };
  }
  const readBack = isFresh(prev) && running === null;
  return {
    facts: {
      running,
      last: readBack ? restoredRun(next, read) : facts.last,
      changed: facts.changed,
    },
    deployed: "keep",
  };
};

export interface AutoOpen {
  prev: RunStates;
  next: RunStates;
  /**
   * A deploy of this tutorial has been seen done before, a restored one
   * included: the next one is not the first
   */
  deployedBefore: boolean;
}

/**
 * Why the drawer opens by itself on this change, or null: a build that ran
 * and failed, or the tutorial's first deploy to land. Every other run leaves
 * the drawer as the learner left it.
 */
export const autoOpenReason = ({
  prev,
  next,
  deployedBefore,
}: AutoOpen): TerminalReason | null => {
  if (prev.build === "running" && next.build === "failed") {
    return "build_failed";
  }
  if (prev.deploy === "running" && next.deploy === "done" && !deployedBefore) {
    return "first_deploy";
  }
  return null;
};

/** Whether `next` starts another workspace's record: the first deploy is due again */
export const resetsDeploys = (next: RunStates) => isFresh(next);

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/tutorial-workspace/model/terminal", () => {
    const facts = (
      last: LastRun | null,
      running: TerminalFacts["running"] = null,
      changed: string | null = null
    ): TerminalFacts => ({ running, last, changed });

    it("reads Ready before anything ran", () => {
      expect(terminalStatus(facts(null))).toEqual({
        text: "Ready",
        tone: "idle",
      });
    });

    it("says what runs while it runs", () => {
      expect(terminalStatus(facts(null, "build")).text).toBe("Building");
      expect(
        terminalStatus(facts({ kind: "deploy", ok: true }, "deploy")).text
      ).toBe("Deploying");
    });

    it("names the IDL a good build made", () => {
      expect(
        terminalStatus(
          facts({ kind: "build", ok: true, instructions: ["hello"] })
        )
      ).toEqual({
        text: "Build successful · IDL: 1 instruction · hello",
        tone: "success",
      });
      expect(
        terminalStatus(
          facts({ kind: "build", ok: true, instructions: ["a", "b"] })
        ).text
      ).toBe("Build successful · IDL: 2 instructions · a · b");
    });

    it("points a failed build at its line when it has one", () => {
      expect(
        terminalStatus(facts({ kind: "build", ok: false, line: 12 }))
      ).toEqual({ text: "Build failed · line 12", tone: "error" });
      expect(
        terminalStatus(facts({ kind: "build", ok: false, line: null })).text
      ).toBe("Build failed");
    });

    it("reads amber once a file changed past a good deploy", () => {
      expect(
        terminalStatus(facts({ kind: "deploy", ok: true }, null, "lib.rs"))
      ).toEqual({
        text: "lib.rs changed since the last deploy",
        tone: "warning",
      });
      // A failed deploy never spoke for the code
      expect(
        terminalStatus(facts({ kind: "deploy", ok: false }, null, "lib.rs"))
          .text
      ).toBe("Deploy failed");
    });

    const at = (build: StageStatus, deploy: StageStatus): RunStates => ({
      build,
      deploy,
    });

    it("opens on a failed build and on the first deploy only", () => {
      const open = (prev: RunStates, next: RunStates, deployedBefore = false) =>
        autoOpenReason({ prev, next, deployedBefore });
      expect(open(at("running", "upcoming"), at("failed", "upcoming"))).toBe(
        "build_failed"
      );
      expect(open(at("running", "upcoming"), at("done", "active"))).toBeNull();
      expect(open(at("done", "running"), at("done", "done"))).toBe(
        "first_deploy"
      );
      expect(open(at("done", "running"), at("done", "done"), true)).toBeNull();
      // A failed deploy prints its log where the learner left the drawer
      expect(open(at("done", "running"), at("done", "failed"))).toBeNull();
      // A restore that reads a deploy back is not a deploy landing
      expect(open(at("done", "upcoming"), at("done", "done"))).toBeNull();
      expect(resetsDeploys(at("upcoming", "upcoming"))).toBe(true);
    });

    const READ: Verdicts = { failedLine: 7, instructions: ["hello"] };
    const READY: TerminalFacts = { running: null, last: null, changed: null };
    const walk = (states: RunStates[], start: TerminalFacts = READY) => {
      let facts = start;
      const steps: Step[] = [];
      for (let i = 1; i < states.length; i++) {
        const step = stepFacts(facts, states[i - 1], states[i], READ);
        steps.push(step);
        facts = step.facts;
      }
      return steps;
    };

    it("turns a finished build into its verdict, failed then fixed", () => {
      const steps = walk([
        at("upcoming", "upcoming"),
        at("running", "upcoming"),
        at("failed", "upcoming"),
        at("running", "upcoming"),
        at("done", "active"),
      ]);
      expect(steps.map((s) => s.facts.running)).toEqual([
        "build",
        null,
        "build",
        null,
      ]);
      expect(steps[1].facts.last).toEqual({
        kind: "build",
        ok: false,
        line: 7,
      });
      expect(steps[3].facts.last).toEqual({
        kind: "build",
        ok: true,
        instructions: ["hello"],
      });
    });

    it("takes a deployed copy on a good deploy only", () => {
      const steps = walk([
        at("done", "active"),
        at("done", "running"),
        at("done", "failed"),
        at("done", "running"),
        at("done", "done"),
      ]);
      expect(steps.map((s) => s.deployed)).toEqual([
        "keep",
        "keep",
        "keep",
        "take",
      ]);
      expect(steps[1].facts.last).toEqual({ kind: "deploy", ok: false });
      expect(terminalStatus(steps[3].facts).text).toBe("Deployed");
    });

    it("reads a reload's record back, and a reset clears it and the copy", () => {
      const [back] = walk([at("upcoming", "upcoming"), at("done", "done")]);
      expect(back.facts.last).toEqual({ kind: "deploy", ok: true });
      const dirty: TerminalFacts = {
        running: null,
        last: { kind: "deploy", ok: true },
        changed: "lib.rs",
      };
      const [reset] = walk(
        [at("done", "done"), at("upcoming", "upcoming")],
        dirty
      );
      expect(reset).toEqual({ facts: READY, deployed: "drop" });
    });

    it("lets a run in flight win over a stale deploy", () => {
      expect(
        terminalStatus(facts({ kind: "deploy", ok: true }, "build", "lib.rs"))
          .text
      ).toBe("Building");
      // An edit past a build, with no deploy, is not amber
      expect(
        terminalStatus(
          facts({ kind: "build", ok: true, instructions: [] }, null, "lib.rs")
        ).tone
      ).toBe("success");
    });
  });
}
