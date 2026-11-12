/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TutorialDefinition } from "@/entities/tutorial";
import type {
  Action,
  EngineContext,
  RunResult,
  Turn,
} from "@/features/tutorial-conversation";
import { pickBuildError } from "@/features/tutorial-conversation/model/build-error";
import { PLANNED_1_1_2 } from "@/features/tutorial-conversation/model/build-logs.fixture";
// Past the slice's entry, which would load the store and the app's globals:
// the engine's pure parts are all this test drives
import {
  INITIAL_ENGINE_STATE,
  reduce,
} from "@/features/tutorial-conversation/model/reducer";
import { view } from "@/features/tutorial-conversation/model/view";
import { requireFor } from "@/test-utils/require-for";
import { stripKnownNoise } from "@/views/sidebar/assistant/bridge/build-output";

import hello from "../../../tutorials/hello-anchor/tutorial.json";
import type { TurnHandlers } from "./TurnView";
import TurnView from "./TurnView";

/**
 * Hello Anchor's planned failure from the Anchor 1.1.2 build server's real log
 * (9 Nov 2026), through the engine and the feed's cards: the specs' "The
 * planned failure" (tutorial-conversation) and "The planned failure is a real
 * compiler error" (tutorial-runs).
 */

const definition = hello as unknown as TutorialDefinition;
const step1 = definition.steps[0];

const ctx: EngineContext = {
  definition,
  slug: "hello-anchor",
  judge: (_goal, result) => result.ok,
};

/** What `runBuild` answers for the real log, with the step's line handed in */
const failed: RunResult = {
  act: "build",
  ok: false,
  seconds: 6,
  reason: "compiler",
  error: pickBuildError(PLANNED_1_1_2, step1.failsWith),
  log: stripKnownNoise(PLANNED_1_1_2),
};

const play = (actions: Action[]) =>
  actions.reduce((s, a) => reduce(ctx, s, a).state, INITIAL_ENGINE_STATE);

const toFailure: Action[] = [
  { type: "start", at: 1000 },
  { type: "pick", beatId: "s1.q1", option: 1, at: 5000 },
  { type: "act", beatId: "s1.build", at: 7000 },
  { type: "ended", beatId: "s1.build", result: failed, at: 13000 },
];

const LATE = { now: Date.now() + 1e9, loadedAt: 0, probing: [] };

const handlers = (): TurnHandlers => ({
  start: vi.fn(),
  pick: vi.fn(),
  hint: vi.fn(),
  skip: vi.fn(),
  typeIt: vi.fn(),
  act: vi.fn(),
  recheck: vi.fn(),
  explain: vi.fn(),
  fixMyself: vi.fn(),
  showFix: vi.fn(),
  next: vi.fn(),
  restartStep: vi.fn(),
  showLine: vi.fn(),
  revealError: vi.fn(),
  openNextTutorial: vi.fn(),
  allTutorials: vi.fn(),
  copyReceipt: vi.fn(),
  copyFailed: vi.fn(),
  showLog: vi.fn(),
  createWallet: vi.fn(),
  fundFor: vi.fn(() => vi.fn()),
  newProgramId: vi.fn(),
  signIn: vi.fn(),
  apply: vi.fn(),
  keep: vi.fn(),
});

const draw = (turn: Turn) => {
  const on = handlers();
  render(
    <TurnView
      turn={turn}
      definition={definition}
      live
      running={false}
      passed={[]}
      read={() => step1.target["src/lib.rs"]}
      nextTutorial={null}
      on={on}
    />
  );
  return on;
};

describe("Hello Anchor's planned failure", () => {
  it("reads E0432 at line 5 off the real log and marks the failure planned", () => {
    expect(failed).toMatchObject({
      error: { code: "E0432", file: "src/lib.rs", line: 5, column: 1 },
    });
    const v = view(definition, play(toFailure), LATE);
    const result = v.turns.find((t) => t.kind === "result");
    expect(result).toMatchObject({ planned: step1.planned, open: true });
    expect(v.live?.id).toBe(result?.id);
  });

  it("draws Build failed with E0432 · line 5, the planned line and the link to it", () => {
    const v = view(definition, play(toFailure), LATE);
    const on = draw(
      requireFor("a result turn")(v.turns.find((t) => t.kind === "result"))
    );
    expect(screen.getByText("Build failed")).toBeTruthy();
    expect(screen.getByText("E0432 · line 5")).toBeTruthy();
    expect(screen.getByText("unresolved import `crate`")).toBeTruthy();
    screen.getByRole("button", { name: "--> src/lib.rs:5:1" }).click();
    expect(on.revealError).toHaveBeenCalledWith("src/lib.rs", 5);
  });

  it("Explain posts the explanation with line 9 quoted, then the Fix it question", () => {
    const explained = play(
      toFailure.concat([{ type: "explain", beatId: "s1.build", at: 14000 }])
    );
    const v = view(definition, explained, LATE);
    expect(v.turns.find((t) => t.id === "f1.explain")).toMatchObject({
      kind: "say",
      quote: { file: "src/lib.rs", line: 9, tone: "error" },
    });
    expect(v.live).toMatchObject({ id: "f1.q2", kind: "ask" });
  });
});

describe("An act the learner stopped (HOO-2822)", () => {
  const stopped: RunResult = {
    act: "build",
    ok: false,
    seconds: 2,
    reason: "stopped",
    error: null,
    log: "Stopped.",
  };
  const toStop = toFailure
    .slice(0, -1)
    .concat([{ type: "ended", beatId: "s1.build", result: stopped, at: 9000 }]);

  it("draws Build stopped, with no failure, no error line and nothing to explain", () => {
    const v = view(definition, play(toStop), LATE);
    draw(requireFor("a result turn")(v.turns.find((t) => t.kind === "result")));
    expect(screen.getByText("Build stopped")).toBeTruthy();
    expect(screen.queryByText(/failed/i)).toBeNull();
    expect(screen.queryByText("Stopped.")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Explain the error" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "I'll fix it myself" })
    ).toBeNull();
  });

  it("follows it at once with Build again, which builds", () => {
    const v = view(definition, play(toStop), LATE);
    const on = draw(requireFor("the live turn")(v.live));
    expect(
      screen.getByText("Stopped. Press Build again when you're ready.")
    ).toBeTruthy();
    screen.getByRole("button", { name: /Build again/ }).click();
    expect(on.act).toHaveBeenCalledWith("s1.build", undefined);
  });

  const cases: { label: string; result: RunResult; title: string }[] = [
    {
      label: "deploy",
      result: {
        act: "deploy",
        ok: false,
        seconds: 1,
        reason: "stopped",
        message: "Stopped.",
      },
      title: "Deploy stopped",
    },
    {
      label: "build and deploy",
      result: {
        act: "buildDeploy",
        ok: false,
        seconds: 1,
        reason: "stopped",
        message: "Stopped.",
      },
      title: "Build and deploy stopped",
    },
    {
      label: "run",
      result: {
        act: "run",
        ok: false,
        seconds: 1,
        reason: "stopped",
        message: "Stopped.",
        log: "",
      },
      title: "Run stopped",
    },
    {
      label: "call",
      result: {
        act: "call",
        ok: false,
        seconds: 1,
        reason: "stopped",
        message: "Stopped.",
        log: "",
      },
      title: "Call stopped",
    },
  ];
  it.each(cases)(
    "draws a stopped $label as stopped, never failed",
    ({ result, title }) => {
      draw({
        id: "result:x:0",
        kind: "result",
        step: step1.id,
        at: 1,
        whole: true,
        beatId: "x",
        act: result.act,
        result,
        took: 1000,
        planned: null,
        open: false,
      });
      expect(screen.getByText(title)).toBeTruthy();
      expect(screen.queryByText(/failed/i)).toBeNull();
      expect(screen.queryByText("Stopped.")).toBeNull();
    }
  );
});
