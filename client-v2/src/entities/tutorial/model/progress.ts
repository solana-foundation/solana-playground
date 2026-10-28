import type { TutorialMetadata } from "../../../utils/tutorial/types";

/** How far the user is through a tutorial, as its card shows it */
export type TutorialProgress =
  | { state: "new" }
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
 * A started tutorial whose saved progress cannot be read (`meta` null) is
 * on page 1, where `PgTutorial.open` takes it too.
 */
export const progressOf = (
  started: boolean,
  meta: TutorialMetadata | null,
  pages: number
): TutorialProgress => {
  if (!started) return { state: "new" };
  if (meta?.completed) return { state: "completed" };
  return { state: "started", page: pageWithin(meta?.pageNumber, pages), pages };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("entities/tutorial/model/progress", () => {
    it("is new when the tutorial is not started", () => {
      expect(progressOf(false, null, 5)).toEqual({ state: "new" });
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

    it("is started on page 1 when the saved progress cannot be read", () => {
      expect(progressOf(true, null, 5)).toEqual({
        state: "started",
        page: 1,
        pages: 5,
      });
    });
  });
}
