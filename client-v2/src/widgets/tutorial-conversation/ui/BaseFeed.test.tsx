/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActBeat, TutorialDefinition } from "@/entities/tutorial";
import type { StepBarItem, Turn } from "@/features/tutorial-conversation";
import { requireFor } from "@/test-utils/require-for";

import hello from "../../../tutorials/hello-anchor/tutorial.json";
import type { BaseFeedProps } from "./BaseFeed";
import BaseFeed from "./BaseFeed";
import type { TurnHandlers } from "./TurnView";
import TurnView from "./TurnView";

const definition = hello as unknown as TutorialDefinition;
const actOf = (id: string) =>
  requireFor(`the act ${id}`)(
    definition.steps
      .flatMap((s) => s.beats)
      .find((b): b is ActBeat => b.kind === "act" && b.id === id)
  );

const divider = (index: number, done: boolean, at: number): Turn => {
  const step = definition.steps[index - 1];
  return {
    id: `divider:${step.id}`,
    kind: "divider",
    step: step.id,
    at,
    whole: true,
    index,
    title: step.title,
    objective: step.objective,
    done,
    took: done ? 41_000 : null,
  };
};

const builtStep1: Turn = {
  id: "s1.build",
  kind: "act",
  step: definition.steps[0].id,
  at: 3,
  whole: true,
  beatId: "s1.build",
  act: actOf("s1.build"),
  state: "done",
  presses: [],
  note: null,
  stage: null,
  took: 1600,
};

const wroteStep1: Turn = {
  id: "wrote:s1.q1",
  kind: "wrote",
  step: definition.steps[0].id,
  at: 2,
  whole: true,
  beatId: "s1.q1",
  wrote: { file: "src/lib.rs", lines: [5, 6, 7] },
  failed: false,
};

const runStep3: Turn = {
  id: "s3.run",
  kind: "act",
  step: definition.steps[2].id,
  at: 30,
  whole: false,
  beatId: "s3.run",
  act: actOf("s3.run"),
  state: "live",
  presses: [],
  note: null,
  stage: null,
  took: null,
};

const intro: Turn = {
  id: "intro",
  kind: "intro",
  step: null,
  at: 0,
  whole: true,
};

const bar = (states: StepBarItem["state"][]): StepBarItem[] =>
  definition.steps.map((step, i) => ({
    id: step.id,
    short: step.short,
    title: step.title,
    state: states[i],
    took: null,
  }));

/** Hello Anchor on step 3: steps 1 and 2 passed */
const onStep3 = {
  turns: [
    divider(1, true, 1),
    wroteStep1,
    builtStep1,
    divider(2, true, 10),
    divider(3, false, 20),
    runStep3,
  ],
  live: runStep3,
  steps: bar(["done", "done", "current", "not_reached"]),
};

const handlers = (): TurnHandlers => ({
  start: vi.fn(),
  pick: vi.fn(),
  hint: vi.fn(),
  skip: vi.fn(),
  typeIt: vi.fn(),
  act: vi.fn(),
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
});

const feed = (
  over: Partial<BaseFeedProps> & {
    turns?: readonly Turn[];
    on?: TurnHandlers;
  } = {}
) => {
  const on = over.on ?? handlers();
  const props: BaseFeedProps = {
    entries:
      over.entries ??
      (over.turns ?? onStep3.turns).map((turn) => ({ kind: "lesson", turn })),
    renderExchange: over.renderExchange ?? (() => undefined),
    live: over.live === undefined ? onStep3.live : over.live,
    steps: over.steps ?? onStep3.steps,
    renderTurn:
      over.renderTurn ??
      ((turn, live) => (
        <TurnView
          turn={turn}
          definition={definition}
          live={live}
          running={false}
          passed={[definition.steps[0].id, definition.steps[1].id]}
          read={() => "a\nb\nc\nd\ne\nf\ng"}
          nextTutorial={null}
          on={on}
        />
      )),
    onJump: over.onJump ?? vi.fn(),
    onBack: over.onBack ?? vi.fn(),
  };
  const { container, rerender } = render(<BaseFeed {...props} />);
  /** Draw the mounted feed again with other turns */
  const redrawWith = (turns: readonly Turn[]) =>
    rerender(
      <BaseFeed
        {...props}
        entries={turns.map((turn) => ({ kind: "lesson" as const, turn }))}
      />
    );
  return { container, props, on, redrawWith };
};

/** The IntersectionObserver the feed made for its live card, to answer by hand */
let observed: ((entries: { isIntersecting: boolean }[]) => void) | null;

beforeEach(() => {
  observed = null;
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        observed = cb;
      }
      observe() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const segment = (name: RegExp) => screen.getByRole("button", { name });

describe("BaseFeed", () => {
  it("is a log the screen reader follows politely", () => {
    feed();
    const log = screen.getByRole("log");
    expect(log.getAttribute("aria-live")).toBe("polite");
  });

  it("renders a turn from before the load whole, and a new one rising", () => {
    const { container } = feed();
    const turns = container.querySelectorAll("[data-turn]");
    expect(turns[0].className).not.toContain("animate-rise");
    expect(turns[turns.length - 1].className).toContain("animate-rise");
    // Under reduced motion a new turn fades in whole, with no rise
    expect(turns[turns.length - 1].className).toContain(
      "motion-reduce:animate-fade"
    );
    expect(turns[0].className).not.toContain("animate-fade");
  });

  it("scrolls when a result card takes its act's place, though the count holds", () => {
    const turns = onStep3.turns;
    const { redrawWith } = feed({ turns });
    const result: Turn = {
      id: "result:replaces-the-act",
      kind: "say",
      step: null,
      at: 40,
      whole: false,
      beatId: "s3.run",
      text: "Stands in for the result card",
    };
    const swapped = turns.slice(0, -1).concat(result);
    vi.mocked(Element.prototype.scrollTo).mockClear();
    redrawWith(swapped);
    expect(Element.prototype.scrollTo).toHaveBeenCalled();
  });

  it("scrolls when a turn lands before the last one, as a late hint does", () => {
    const turns = onStep3.turns;
    const { redrawWith } = feed({ turns });
    const hint: Extract<Turn, { kind: "hint" }> = {
      id: "hint:late",
      kind: "hint",
      step: null,
      at: 1,
      whole: false,
      beatId: "s3.q3",
      text: "A hint",
    };
    vi.mocked(Element.prototype.scrollTo).mockClear();
    redrawWith((turns as Turn[]).slice(0, 0).concat(hint, turns));
    expect(Element.prototype.scrollTo).toHaveBeenCalled();
  });

  it("sets each turn's gap from the one before it, the feed starting flush", () => {
    const { container } = feed();
    const turns = Array.from(
      container.querySelectorAll<HTMLElement>("[data-turn]")
    );
    expect(turns[0].style.marginTop).toBe("0px");
    turns.slice(1).forEach((el, i) => {
      if (el.dataset.turn === "divider")
        expect(el.style.marginTop).toBe("30px");
      if (
        turns[i].dataset.turn === "divider" &&
        el.dataset.turn !== "divider"
      ) {
        expect(el.style.marginTop).toBe("9px");
      }
    });
    expect(turns.some((el) => el.dataset.turn === "divider")).toBe(true);
  });

  it("jumps from step 3 to step 1, and keeps step 3 the live one", async () => {
    const onJump = vi.fn();
    const { container } = feed({ onJump });
    // jsdom lays nothing out: give each divider a place of its own
    container
      .querySelectorAll("[data-turn='divider']")
      .forEach((el, i) =>
        Object.defineProperty(el, "offsetTop", { value: 100 + i * 400 })
      );
    vi.mocked(Element.prototype.scrollTo).mockClear();
    await userEvent.click(segment(/^Step 1 of 4, Program, done$/));

    expect(Element.prototype.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: 100 - 22 })
    );
    expect(onJump).toHaveBeenCalledWith(0, 2, "bar");
    expect(
      segment(/^Step 1 of 4, Program, done$/).getAttribute("aria-current")
    ).toBe("location");
    expect(
      segment(/^Step 3 of 4, Client, current$/).getAttribute("aria-current")
    ).toBe("step");
    expect(screen.getByRole("button", { name: "Back to step 3" })).toBeTruthy();
  });

  it("keeps no buttons in a passed step's records, but its wrote card still opens the lines", async () => {
    const on = handlers();
    const { container } = feed({ on });
    const log = within(screen.getByRole("log"));
    expect(log.getByText("Built in 1.6 s")).toBeTruthy();

    const step1 = Array.from(container.querySelectorAll("[data-turn]")).slice(
      0,
      3
    );
    const buttons = step1.flatMap((el) =>
      Array.from(el.querySelectorAll("button"))
    );
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Show lines 5 to 7 in src/lib.rs",
    ]);
    await userEvent.click(buttons[0]);
    expect(on.showLine).toHaveBeenCalledWith("src/lib.rs", 5);
  });

  it("moves to the previous divider on ⌥↑, never past the live step on ⌥↓", () => {
    const onJump = vi.fn();
    feed({ onJump });
    fireEvent.keyDown(document, { key: "ArrowUp", altKey: true });
    expect(onJump).toHaveBeenLastCalledWith(1, 2, "key");
    fireEvent.keyDown(document, { key: "ArrowDown", altKey: true });
    expect(onJump).toHaveBeenLastCalledWith(2, 2, "key");
    onJump.mockClear();
    fireEvent.keyDown(document, { key: "ArrowDown", altKey: true });
    expect(onJump).not.toHaveBeenCalled();
  });

  it("takes the learner back to the live card from the pill, and focuses its first control", async () => {
    // Reduced motion: the focus follows at once rather than after the scroll
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const onBack = vi.fn();
    feed({ onBack });
    await userEvent.click(segment(/^Step 1 of 4, Program, done$/));
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    await userEvent.click(
      screen.getByRole("button", { name: "Back to step 3" })
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    await act(() => new Promise((done) => setTimeout(done, 0)));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /Run/ })
    );
    expect(onBack).toHaveBeenCalledWith(2);
    expect(screen.queryByRole("button", { name: /^Back to/ })).toBeNull();
  });

  it("leaves ⌥↑ to a field that has focus", () => {
    const onJump = vi.fn();
    feed({ onJump });
    const field = document.createElement("input");
    document.body.appendChild(field);
    fireEvent.keyDown(field, { key: "ArrowUp", altKey: true });
    expect(onJump).not.toHaveBeenCalled();
    field.remove();
  });

  /** Lay the dividers out at 0, 300 and 900 px, and the feed at `scrollTop` */
  const layout = (
    container: HTMLElement,
    box: { scrollTop: number; clientHeight: number; scrollHeight: number }
  ) => {
    container
      .querySelectorAll("[data-turn='divider']")
      .forEach((el, i) =>
        Object.defineProperty(el, "offsetTop", { value: [0, 300, 900][i] })
      );
    const scroller = requireFor("the log")(
      container.querySelector("[role='log']")
    ).parentElement as HTMLElement;
    for (const [key, value] of Object.entries(box)) {
      Object.defineProperty(scroller, key, { value, configurable: true });
    }
    return scroller;
  };

  it("reads a feed scrolled to its bottom as on the live step, though step 3's divider never reached the bar", () => {
    const { container } = feed();
    // Scrolled by hand to the bottom: step 3's divider (900) is below the
    // feed's top (600 + `HEADING_TOP`), so the divider rule alone would name step 2
    const box = layout(container, {
      scrollTop: 600,
      clientHeight: 400,
      scrollHeight: 1000,
    });
    fireEvent.scroll(box);
    expect(
      segment(/^Step 2 of 4, .*, done$/).getAttribute("aria-current")
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /^Back to/ })).toBeNull();
  });

  it("reads a feed scrolled by hand above the bottom as on the step under the bar", () => {
    const { container } = feed();
    const box = layout(container, {
      scrollTop: 600,
      clientHeight: 400,
      scrollHeight: 2000,
    });
    fireEvent.scroll(box);
    expect(
      segment(/^Step 2 of 4, .*, done$/).getAttribute("aria-current")
    ).toBe("location");
  });

  it("keeps a jump's target as the location while the jump's own scroll lands at the bottom", async () => {
    const { container } = feed();
    const box = layout(container, {
      scrollTop: 600,
      clientHeight: 400,
      scrollHeight: 1000,
    });
    await userEvent.click(segment(/^Step 2 of 4, .*, done$/));
    fireEvent.scroll(box);
    expect(
      segment(/^Step 2 of 4, .*, done$/).getAttribute("aria-current")
    ).toBe("location");
    expect(screen.getByRole("button", { name: "Back to step 3" })).toBeTruthy();
  });

  it("reads Back to the start before Start, once the intro is off screen", () => {
    feed({
      turns: [intro],
      live: intro,
      steps: bar(["not_reached", "not_reached", "not_reached", "not_reached"]),
    });
    expect(screen.queryByRole("button", { name: /^Back to/ })).toBeNull();
    act(() => observed?.([{ isIntersecting: false }]));
    expect(
      screen.getByRole("button", { name: "Back to the start" })
    ).toBeTruthy();
  });

  it("has no pill after the finish", async () => {
    feed({ live: null, steps: bar(["done", "done", "done", "done"]) });
    await userEvent.click(segment(/^Step 1 of 4, Program, done$/));
    expect(screen.queryByRole("button", { name: /^Back to/ })).toBeNull();
  });
});
