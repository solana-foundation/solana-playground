/* eslint-disable max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useReducer, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Ask, TutorialDefinition } from "@/entities/tutorial";
import type {
  Action,
  Effect,
  EngineContext,
  EngineState,
} from "@/features/tutorial-conversation";
import {
  INITIAL_ENGINE_STATE,
  insertBlock,
  reduce,
  stepOfBeat,
  typedKey,
  view,
  withOwnText,
} from "@/features/tutorial-conversation";
import { requireFor } from "@/test-utils/require-for";

import hello from "../../../tutorials/hello-anchor/tutorial.json";

// The engine's entry also exports its store, which drags in the app's
// generated globals; the card needs only the pure engine behind it
vi.mock("@/features/tutorial-conversation", async () => {
  const reducer = await import(
    "@/features/tutorial-conversation/model/reducer"
  );
  const landing = await import(
    "@/features/tutorial-conversation/model/landing"
  );
  return {
    INITIAL_ENGINE_STATE: reducer.INITIAL_ENGINE_STATE,
    reduce: reducer.reduce,
    stepOfBeat: reducer.stepOfBeat,
    view: (await import("@/features/tutorial-conversation/model/view")).view,
    insertBlock: landing.insertBlock,
    typedKey: landing.typedKey,
    withOwnText: landing.withOwnText,
  };
});

import { RIGHT_HOLD_MS } from "./BaseQuestionCard";
import TurnView from "./TurnView";

/**
 * The question card over the real engine: the feed's turns from `view`, the
 * card's clicks and keys through `reduce`, and the engine's writes carried
 * out on an in-memory file map the way `PgConversation` carries them out.
 * Only the store and the workspace are left out.
 */

const definition = hello as unknown as TutorialDefinition;
const ctx: EngineContext = {
  definition,
  slug: "hello-anchor",
  judge: (_goal, result) => result.ok,
};
const q1 = requireFor("a question beat")(
  definition.steps[0].beats.find((b): b is Ask => b.kind === "ask")
);

interface World {
  engine: EngineState;
  files: Record<string, string>;
  events: Effect[];
  /** The engine's requests for the caret, as `PgConversation` passes them on */
  focus: Effect[];
}

/** Carries out a write as the store does: the key line kept in the block */
const carryOut = (world: World, effect: Effect, at: number): Action[] => {
  if (effect.kind === "restore") {
    for (const [path, content] of Object.entries(effect.files)) {
      world.files[path] = content;
    }
    return [];
  }
  if (effect.kind === "event") {
    world.events.push(effect);
    return [];
  }
  if (effect.kind === "focus") {
    world.focus.push(effect);
    return [];
  }
  if (effect.kind !== "write") return [];
  const step = stepOfBeat(definition, effect.beatId);
  let base = world.files[effect.file] ?? "";
  let block = effect.block;
  const keyAt = effect.key ? typedKey(base, effect.key) : null;
  if (keyAt !== null) {
    const rows = base.split("\n");
    block = withOwnText(block, rows[keyAt - 1]);
    rows.splice(keyAt - 1, 1);
    base = rows.join("\n");
  }
  const placed = insertBlock(
    base,
    block,
    step?.target[effect.file],
    step?.start[effect.file] ?? ""
  );
  world.files[effect.file] = placed.code;
  return [
    {
      type: "written",
      beatId: effect.beatId,
      wrote: { file: effect.file, lines: placed.lines },
      at,
    },
  ];
};

const apply = (world: World, action: Action) => {
  const queue: Action[] = [action];
  while (queue.length) {
    const next = requireFor("a queued answer")(queue.shift());
    const r = reduce(ctx, world.engine, next);
    world.engine = r.state;
    for (const effect of r.effects) {
      queue.push(...carryOut(world, effect, next.at));
    }
  }
};

let clock = 1000;
const now = () => (clock += 100);

const Lesson = ({ world }: { world: World }) => {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const ref = useRef(world);
  const send = (action: Action) => {
    apply(ref.current, action);
    redraw();
  };
  const v = view(definition, ref.current.engine, {
    now: 1e12,
    loadedAt: 0,
    probing: [],
  });
  return (
    <div role="log">
      {v.turns.map((turn) => (
        <TurnView
          key={turn.id}
          turn={turn}
          definition={definition}
          live={v.live?.id === turn.id}
          running={false}
          passed={ref.current.engine.progress.passed}
          nextTutorial={null}
          read={(file) => ref.current.files[file] ?? null}
          on={{
            start: () => send({ type: "start", at: now() }),
            pick: (beatId, option) =>
              send({ type: "pick", beatId, option, at: now() }),
            hint: (beatId) => send({ type: "hint", beatId, at: now() }),
            skip: (beatId) => send({ type: "skip", beatId, at: now() }),
            typeIt: (beatId) => send({ type: "typeIt", beatId, at: now() }),
            act: vi.fn(),
            recheck: vi.fn(),
            explain: vi.fn(),
            fixMyself: vi.fn(),
            showFix: vi.fn(),
            next: vi.fn(),
            restartStep: vi.fn(),
            openNextTutorial: vi.fn(),
            allTutorials: vi.fn(),
            copyReceipt: vi.fn(),
            copyFailed: vi.fn(),
            apply: vi.fn(),
            keep: vi.fn(),
            showLine: vi.fn(),
            revealError: vi.fn(),
            showLog: vi.fn(),
            createWallet: vi.fn(),
            signIn: vi.fn(),
          }}
        />
      ))}
    </div>
  );
};

/** Hello Anchor started: step 1, its first question open */
const started = (): World => {
  const world: World = {
    engine: INITIAL_ENGINE_STATE,
    files: {},
    events: [],
    focus: [],
  };
  apply(world, { type: "start", at: now() });
  return world;
};

const press = (key: string) => fireEvent.keyDown(window, { key });

const answered = (world: World) =>
  world.events.filter(
    (e) => e.kind === "event" && e.name === "tutorial_question_answered"
  );

describe("the question card over the engine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("A wrong pick, then the right one", () => {
    const world = started();
    render(<Lesson world={world} />);
    const card = screen.getByRole("region", {
      name: "Which line writes to the program log?",
    });
    expect(document.activeElement).toBe(card);

    // 1 is println!, the wrong one
    press("1");
    const rows = within(card).getAllByRole("button").slice(0, 3);
    expect(rows[0].getAttribute("aria-disabled")).toBe("true");
    expect(rows[0].textContent).toContain(
      "Not quite. println! prints to a terminal, and a program on Solana has none. On chain, a program talks through msg!."
    );
    const reason = document.getElementById(
      requireFor("the row's reason id")(
        rows[0].getAttribute("aria-describedby")
      )
    );
    expect(reason?.textContent).toContain("Not quite.");
    expect(rows[0].className).toContain("pg-shake");
    // The focus moves on to the next row still to pick
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(document.activeElement).toBe(rows[1]);

    // 2 is msg!: green, held, then sent
    press("2");
    expect(rows[1].getAttribute("data-state")).toBe("right");
    expect(world.engine.progress.beats["s1.q1"]?.kind).toBe("open");
    act(() => {
      vi.advanceTimersByTime(RIGHT_HOLD_MS);
    });

    expect(
      screen.queryByRole("region", {
        name: "Which line writes to the program log?",
      })
    ).toBeNull();
    const record = screen.getByRole("button", { name: /Q1/ });
    expect(record.textContent).toContain("· 2nd try");
    expect(
      screen.getByRole("button", { name: "Show lines 5 to 13 in src/lib.rs" })
    ).toBeTruthy();
    expect(world.files["src/lib.rs"]).toContain('msg!("Hello, World!");');
    expect(answered(world)).toEqual([
      {
        kind: "event",
        name: "tutorial_question_answered",
        params: {
          tutorial: "hello-anchor",
          question: "s1.q1",
          result: "retry",
          attempts: 2,
        },
      },
    ]);

    // The record opens to the three rows in their final states, with reasons
    fireEvent.click(record);
    expect(record.getAttribute("aria-expanded")).toBe("true");
    const states = Array.from(document.querySelectorAll("[data-state]")).map(
      (el) => el.getAttribute("data-state")
    );
    expect(states).toEqual(["wrong", "right", "left"]);
  });

  it("outlines the last row after two wrong picks", () => {
    render(<Lesson world={started()} />);
    press("1");
    press("3");
    const card = screen.getByRole("region", {
      name: "Which line writes to the program log?",
    });
    const rows = within(card).getAllByRole("button").slice(0, 3);
    expect(rows[1].className).toContain("border-foreground/30");
    expect(rows[0].className).not.toContain("border-foreground/30");
  });

  it("H posts the hint once and its button goes; S skips and writes the block", () => {
    const world = started();
    render(<Lesson world={world} />);
    press("h");
    expect(screen.getByText("I'm stuck")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hint" })).toBeNull();
    press("h");
    expect(screen.getAllByText("I'm stuck")).toHaveLength(1);

    press("s");
    expect(screen.getByRole("button", { name: /Q1/ }).textContent).toContain(
      "· skipped"
    );
    expect(world.files["src/lib.rs"]).toContain('msg!("Hello, World!");');
    expect(answered(world)).toHaveLength(1);
  });

  it("leaves the keys to a field that has focus", () => {
    const world = started();
    render(
      <>
        <textarea aria-label="composer" />
        <Lesson world={world} />
      </>
    );
    const field = screen.getByRole("textbox", { name: "composer" });
    field.focus();
    fireEvent.keyDown(field, { key: "2" });
    act(() => {
      vi.advanceTimersByTime(RIGHT_HOLD_MS);
    });
    expect(world.engine.progress.beats["s1.q1"]?.kind).toBe("open");
  });

  it("typing the key line resolves it as typed by you, and the rest of the block is filled in", () => {
    const world = started();
    // The learner types the key line under the boilerplate
    const lines =
      `${world.files["src/lib.rs"]}\n\nmsg!("Hello, World!");`.split("\n");
    apply(world, {
      type: "edit",
      file: "src/lib.rs",
      content: lines.join("\n"),
      at: now(),
    });
    render(<Lesson world={world} />);
    expect(
      screen.getAllByRole("button", { name: /Q1/ })[0].textContent
    ).toContain("· typed by you");
    // The rest of the block is filled in around the typed line, once
    const lib = world.files["src/lib.rs"];
    expect(lib).toContain("pub fn hello(_ctx: Context<Hello>) -> Result<()> {");
    expect(lib).toContain("Ok(())");
    expect(lib.split('msg!("Hello, World!");')).toHaveLength(2);
    expect(answered(world)[0]).toMatchObject({
      params: { result: "typed", attempts: 1 },
    });
  });

  it("Type it myself asks the engine for the caret at the landing in lib.rs", () => {
    const world = started();
    render(<Lesson world={world} />);
    fireEvent.click(screen.getByRole("button", { name: "Type it myself" }));
    expect(world.focus).toEqual([
      { kind: "focus", file: "src/lib.rs", line: "landing" },
    ]);
    expect(world.engine.progress.beats["s1.q1"]?.kind).toBe("open");
  });

  it("posts the definition's hint once, for the button and for H", () => {
    render(<Lesson world={started()} />);
    fireEvent.click(screen.getByRole("button", { name: "Hint" }));
    expect(screen.getAllByText(q1.hint as string)).toHaveLength(1);
    press("h");
    expect(screen.getAllByText(q1.hint as string)).toHaveLength(1);
  });

  it("takes no second click on a ruled-out row", () => {
    const world = started();
    render(<Lesson world={world} />);
    press("1");
    const card = screen.getByRole("region", {
      name: "Which line writes to the program log?",
    });
    fireEvent.click(within(card).getAllByRole("button")[0]);
    press("1");
    expect(world.engine.progress.beats["s1.q1"]).toMatchObject({
      kind: "open",
      wrong: [0],
    });
  });

  it.each([
    ["⌘S", { key: "s", metaKey: true }],
    ["Ctrl+1", { key: "1", ctrlKey: true }],
    ["a held key's repeat", { key: "s", repeat: true }],
  ])("leaves %s alone", (_, init) => {
    const world = started();
    render(<Lesson world={world} />);
    fireEvent.keyDown(window, init);
    act(() => {
      vi.advanceTimersByTime(RIGHT_HOLD_MS);
    });
    expect(world.engine.progress.beats["s1.q1"]?.kind).toBe("open");
  });

  it("leaves the keys to an open dialog", () => {
    const world = started();
    render(
      <>
        <div role="dialog" aria-label="Settings">
          <button type="button">Close</button>
        </div>
        <Lesson world={world} />
      </>
    );
    screen.getByRole("button", { name: "Close" }).focus();
    press("s");
    expect(world.engine.progress.beats["s1.q1"]?.kind).toBe("open");
  });

  it("arriving under an open popover, leaves the focus in it", () => {
    // The workspace's file tree is a dialog popover: a question that arrives
    // while it is open must not take the focus, or the tree closes under the
    // learner
    const world = started();
    const Page = ({ asked }: { asked: boolean }) => (
      <>
        <div role="dialog" aria-label="Files">
          <button type="button">lib.rs</button>
        </div>
        {asked && <Lesson world={world} />}
      </>
    );
    const { rerender } = render(<Page asked={false} />);
    screen.getByRole("button", { name: "lib.rs" }).focus();
    rerender(<Page asked />);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "lib.rs" })
    );
  });

  it("moves between the rows with the arrows, and Enter picks the focused one", () => {
    const world = started();
    render(<Lesson world={world} />);
    const card = screen.getByRole("region", {
      name: "Which line writes to the program log?",
    });
    const rows = within(card).getAllByRole("button").slice(0, 3);
    press("ArrowDown");
    expect(document.activeElement).toBe(rows[0]);
    press("ArrowDown");
    expect(document.activeElement).toBe(rows[1]);
    press("ArrowUp");
    press("ArrowUp");
    expect(document.activeElement).toBe(rows[0]);
    // Enter on a focused button is the browser's click
    press("ArrowDown");
    fireEvent.click(requireFor("the focused element")(document.activeElement));
    act(() => {
      vi.advanceTimersByTime(RIGHT_HOLD_MS);
    });
    expect(world.engine.progress.beats["s1.q1"]).toMatchObject({
      kind: "picked",
      attempts: 1,
    });
  });
});
