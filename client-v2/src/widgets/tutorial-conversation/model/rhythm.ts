/* eslint-disable layers/curry-order, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { Turn } from "@/features/tutorial-conversation";

import type { FeedEntry } from "./merge";

/** What the rhythm reads of a turn: its kind, and a say's quote */
export type Spaced = Pick<Turn, "kind"> & { quote?: unknown };

/**
 * A feed entry as the rhythm reads it: a question to the assistant stands
 * as the learner's turn, and its answer as the lesson's own text, since the
 * two share one thread
 */
export const spacedOf = (entry: FeedEntry): Spaced => {
  if (entry.kind === "lesson") return entry.turn;
  return { kind: entry.kind === "asked" ? "you" : "say" };
};

/**
 * The feed's vertical rhythm, after the prototype's `Conversation` at
 * `f7d42bf2e` (Practicum's lesson at 400 px): how far, in px, a turn stands
 * under the one before it.
 *
 * - Paragraphs of one reply stand 15 apart; a reply and a learner's turn 24.
 * - A step's heading belongs to the text under it: 30 above it, 9 under.
 * - A listing (a wrote card) sits 9 under the text it follows; text resuming
 *   after a listing, a quote or a card starts a new thought, 24 under it.
 */
export const gapBefore = (prev: Spaced | undefined, turn: Spaced): number => {
  if (!prev) return 0;
  if (turn.kind === "divider") return 30;
  if (prev.kind === "divider") return 9;
  if (turn.kind === "you" || prev.kind === "you") return 24;
  if (turn.kind === "wrote") return 9;
  if (prev.kind === "wrote") return 24;
  if (prev.kind === "say") return prev.quote ? 24 : 15;
  return turn.kind === "say" ? 24 : 15;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/tutorial-conversation/model/rhythm", () => {
    const base = { at: 0, step: "program", whole: true };
    const say = (quote = false): Turn =>
      quote
        ? {
            id: "s",
            at: base.at,
            step: base.step,
            whole: base.whole,
            kind: "say",
            beatId: "b",
            text: "Hi",
            quote: { file: "src/lib.rs", line: 1, tone: "lit" },
          }
        : {
            id: "s",
            at: base.at,
            step: base.step,
            whole: base.whole,
            kind: "say",
            beatId: "b",
            text: "Hi",
          };
    const wrote: Turn = {
      id: "w",
      at: base.at,
      step: base.step,
      whole: base.whole,
      kind: "wrote",
      beatId: "b",
      wrote: null,
      failed: false,
    };
    const you: Turn = {
      id: "y",
      at: base.at,
      step: base.step,
      whole: base.whole,
      kind: "you",
      text: "Hi",
      code: false,
    };
    const divider: Turn = {
      id: "d",
      at: base.at,
      step: base.step,
      whole: base.whole,
      kind: "divider",
      index: 2,
      title: "Deploy",
      objective: "Put it on devnet",
      done: false,
      took: null,
    };

    it("starts the feed flush", () => {
      expect(gapBefore(undefined, say())).toBe(0);
    });

    it("sets paragraphs of a reply 15 apart and a learner's turn 24", () => {
      expect(gapBefore(say(), say())).toBe(15);
      expect(gapBefore(say(), you)).toBe(24);
      expect(gapBefore(you, say())).toBe(24);
    });

    it("gives a step's heading 30 above and 9 under", () => {
      expect(gapBefore(say(), divider)).toBe(30);
      expect(gapBefore(divider, say())).toBe(9);
    });

    it("hangs a listing 9 under its text and starts the text after it 24 under", () => {
      expect(gapBefore(say(), wrote)).toBe(9);
      expect(gapBefore(wrote, say())).toBe(24);
      expect(gapBefore(say(true), say())).toBe(24);
    });

    it("spaces an exchange with the assistant as the learner's turn and the lesson's text", () => {
      const asked: FeedEntry = {
        kind: "asked",
        id: "u",
        at: 0,
        whole: true,
        text: "why?",
      };
      const answer: FeedEntry = {
        kind: "answer",
        id: "a",
        at: 0,
        whole: true,
        text: "Because.",
        tone: "reply",
      };
      expect(
        gapBefore(spacedOf({ kind: "lesson", turn: say() }), spacedOf(asked))
      ).toBe(24);
      expect(gapBefore(spacedOf(asked), spacedOf(answer))).toBe(24);
      expect(
        gapBefore(spacedOf(answer), spacedOf({ kind: "lesson", turn: divider }))
      ).toBe(30);
    });
  });
}
