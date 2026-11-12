import { slugOf } from "./definition/check";

/**
 * The tutorials the start offers, in the order a new developer takes them:
 * one per level, all Anchor. Home, the Tutorials page and New project list
 * only these; every other tutorial stays registered, so its link keeps
 * working. What the Start here banner says of a lesson, as the
 * tutorial-v2 prototype's lessons write it (`lessons/<slug>.ts`): `line`
 * before a start, `done` once finished (its `headline`, no full stop); a
 * definition has neither, and two of the three are not definitions yet.
 */
export const START_LADDER = [
  {
    name: "Hello Anchor",
    line: "Write, deploy and call your first program",
    done: "You built and called your first Solana program",
  },
  {
    name: "Lumberjack",
    line: "Keep a player's state on chain and refill energy over time",
    done: "You built an energy system on chain",
  },
  {
    name: "Zero Copy",
    line: "Make accounts bigger than a program's memory",
    done: "You read 40 KB without copying it",
  },
] as const;

/**
 * Whether a tutorial, by slug, is on the ladder: the only tutorials a finish
 * may recommend next (`finish.next`), as `yarn tutorial:check` enforces and
 * the finish card's "Next" obeys
 */
export const isOnStartLadder = (slug: string) =>
  START_LADDER.some((l) => slugOf(l.name) === slug);

/** What the banner says of a ladder tutorial before a start and once done */
export const ladderLine = (
  name: string
): { line: string; done: string } | undefined =>
  START_LADDER.find((l) => l.name === name);

/**
 * The registered tutorials of the ladder, in its order. One that is not
 * registered (a build without its files) is left out, not invented.
 */
export const startTutorials = <T extends { name: string }>(
  all: readonly T[]
): T[] => START_LADDER.flatMap((l) => all.filter((t) => t.name === l.name));

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("entities/tutorial/model/start-ladder", () => {
    const named = (...names: string[]) => names.map((name) => ({ name }));

    it("keeps only the ladder's tutorials, in its order", () => {
      expect(
        startTutorials(
          named("Zero Copy", "Hello Seahorse", "Lumberjack", "Hello Anchor")
        ).map((t) => t.name)
      ).toEqual(["Hello Anchor", "Lumberjack", "Zero Copy"]);
    });

    it("names its three tutorials by slug, and no other", () => {
      expect(
        ["hello-anchor", "lumberjack", "zero-copy"].every(isOnStartLadder)
      ).toBe(true);
      expect(isOnStartLadder("battle-coins")).toBe(false);
      expect(isOnStartLadder("Lumberjack")).toBe(false);
    });

    it("leaves out a ladder tutorial that is not registered", () => {
      expect(startTutorials(named("Hello Anchor")).map((t) => t.name)).toEqual([
        "Hello Anchor",
      ]);
    });

    it("names each lesson's line", () => {
      expect(ladderLine("Zero Copy")?.line).toBe(
        "Make accounts bigger than a program's memory"
      );
      expect(ladderLine("Zero Copy")?.done).toBe(
        "You read 40 KB without copying it"
      );
      expect(ladderLine("Hello Seahorse")).toBeUndefined();
    });
  });
}
