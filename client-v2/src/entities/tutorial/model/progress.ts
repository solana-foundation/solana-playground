import type { TutorialMetadata } from "../../../utils/tutorial/types";

/** How far the user is through a tutorial, as its card shows it */
export type TutorialProgress =
  | { state: "new" }
  /** `page` is the page open, or a conversation tutorial's steps passed */
  | { state: "started"; page: number; pages: number }
  | { state: "completed" };

/**
 * A saved page as a page of the tutorial: the file is read unchecked, and a
 * tutorial can lose pages after the save, so anything else is page 1 or the
 * last page
 */
const pageWithin = (page: unknown, pages: number) =>
  Number.isInteger(page) ? Math.min(Math.max(page as number, 1), pages) : 1;

/**
 * A tutorial's progress from whether its workspace exists and what it saved.
 * A started tutorial whose saved progress cannot be read (`meta` undefined) is
 * on page 1, where `PgTutorial.open` takes it too.
 */
export const progressOf = (
  started: boolean,
  meta: TutorialMetadata | undefined,
  pages: number
): TutorialProgress => {
  if (!started) return { state: "new" };
  if (meta?.completed) return { state: "completed" };
  return { state: "started", page: pageWithin(meta?.pageNumber, pages), pages };
};

/**
 * What a conversation tutorial keeps under `conversation` in
 * `.workspace/tutorial-storage.json` for its card to read. This reader defines
 * the shape; the conversation engine (tutorial-flow-v2 task 3.1) writes it,
 * and may add fields of its own beside these.
 */
export interface ConversationSave {
  version: 1;
  /** Ids of the steps passed, in any order */
  passed: string[];
  /** When the finish card showed, in ms, or null before it has */
  finishedAt: number | null;
  /** When Start was pressed, in ms; null before Start and after Start over */
  startedAt: number | null;
}

/**
 * A conversation tutorial's progress from its `ConversationSave`. `page` is
 * then the number of steps passed, 0 to m, so the card reads "2 of 4". A save
 * whose Start was never pressed, or pressed before a Start over, is new:
 * opening the tutorial creates its workspace and save, but only Start starts
 * it. Null when `saved` is not one.
 */
export const conversationProgressOf = (
  saved: unknown,
  stepIds: readonly string[]
): TutorialProgress | null => {
  // eslint-disable-next-line unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
  if (typeof saved !== "object" || saved === null) return null;
  const { version, passed, finishedAt, startedAt } = saved as Record<
    string,
    unknown
  >;
  // eslint-disable-next-line unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
  if (version !== 1 || !Array.isArray(passed)) return null;
  if (typeof finishedAt === "number") return { state: "completed" };
  if (typeof startedAt !== "number") return { state: "new" };
  const done = new Set(passed.filter((id) => stepIds.includes(id as string)));
  return { state: "started", page: done.size, pages: stepIds.length };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("entities/tutorial/model/progress", () => {
    it("is new when the tutorial is not started", () => {
      expect(progressOf(false, undefined, 5)).toEqual({ state: "new" });
    });

    it("is the saved page of the tutorial's pages once started", () => {
      expect(progressOf(true, { pageNumber: 2, completed: false }, 5)).toEqual({
        state: "started",
        page: 2,
        pages: 5,
      });
    });

    it("is completed once the tutorial says so", () => {
      expect(progressOf(true, { pageNumber: 5, completed: true }, 5)).toEqual({
        state: "completed",
      });
    });

    it("keeps a saved page inside the tutorial's pages", () => {
      const at = (pageNumber: unknown) =>
        progressOf(
          true,
          { pageNumber: pageNumber as number, completed: false },
          5
        );
      expect(at(7)).toEqual({ state: "started", page: 5, pages: 5 });
      expect(at(0)).toEqual({ state: "started", page: 1, pages: 5 });
      expect(at("2")).toEqual({ state: "started", page: 1, pages: 5 });
      expect(at(null)).toEqual({ state: "started", page: 1, pages: 5 });
    });

    describe("conversationProgressOf", () => {
      const STEPS = ["program", "deploy", "client", "name"];
      const saved = (
        passed: unknown,
        // eslint-disable-next-line layers/curry-order, unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
        finishedAt: unknown = null,
        // eslint-disable-next-line layers/curry-order -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
        startedAt: unknown = 1000
        // eslint-disable-next-line max-params -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
      ) => ({
        version: 1,
        passed,
        finishedAt,
        startedAt,
      });

      it("counts the passed steps of the definition's steps", () => {
        expect(
          conversationProgressOf(saved(["program", "deploy"]), STEPS)
        ).toEqual({ state: "started", page: 2, pages: 4 });
      });

      it("is completed once the finish card has shown", () => {
        expect(
          conversationProgressOf(saved(STEPS, 1730000000000), STEPS)
        ).toEqual({ state: "completed" });
      });

      it("counts only steps the definition still has, each once", () => {
        expect(
          conversationProgressOf(saved(["program", "program", "gone"]), STEPS)
        ).toEqual({ state: "started", page: 1, pages: 4 });
      });

      it("is new until Start is pressed, and again after Start over", () => {
        // eslint-disable-next-line unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
        expect(conversationProgressOf(saved([], null, null), STEPS)).toEqual({
          state: "new",
        });
      });

      it("is started on Start, before any step passes", () => {
        expect(conversationProgressOf(saved([]), STEPS)).toEqual({
          state: "started",
          page: 0,
          pages: 4,
        });
      });

      it("is nothing to go on without a saved conversation", () => {
        expect(conversationProgressOf(undefined, STEPS)).toBeNull();
        expect(
          conversationProgressOf({ version: 2, passed: [] }, STEPS)
        ).toBeNull();
        expect(conversationProgressOf(saved("program"), STEPS)).toBeNull();
      });
    });

    it("is started on page 1 when the saved progress cannot be read", () => {
      expect(progressOf(true, undefined, 5)).toEqual({
        state: "started",
        page: 1,
        pages: 5,
      });
    });
  });
}
