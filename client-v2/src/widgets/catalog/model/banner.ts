/* eslint-disable layers/curry-order -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import type { TutorialItem } from "./use-tutorial-list";

/** Which of its three states the banner is in, as `catalog_banner_opened` sends it */
export type BannerState = "fresh" | "started" | "completed";

/** What the Start here banner says, by its state */
export type Banner = {
  /** The tutorial's name, which is also what its Open is called with */
  id: string;
  title: string;
  /** "Start here", "Continue · Step 3 of 4", "Completed" */
  label: string;
  line: string;
} & (
  | {
      state: "fresh";
      /** The facts that decide a start */
      meta: string;
      /** The same on a phone, level first; the card below names the rest */
      phoneMeta: string;
      action: "Start";
    }
  | {
      state: "started";
      /** How far it is: `done` of `of` */
      meter: { done: number; of: number };
      action: "Continue";
    }
  | { state: "completed"; action: "Open again" }
);

/** The fields of a tutorial the banner reads */
export type BannerItem = Pick<
  TutorialItem,
  | "id"
  | "title"
  | "description"
  | "level"
  | "framework"
  | "authors"
  | "progress"
  | "pages"
  | "lesson"
>;

/**
 * The tutorial the banner features: the first of the start's ladder not yet
 * completed, or the last once all are (the tutorial-v2 prototype's
 * `useFeatured`). `items` are in ladder order. None when there are none.
 */
export const featuredOf = <T extends Pick<TutorialItem, "progress">>(
  items: readonly T[]
): T | undefined =>
  items.find((t) => t.progress.state !== "completed") ?? items.at(-1);

/**
 * The banner for a tutorial. One with a definition counts steps: a started
 * one names the first step not passed, read as the step after the passed
 * count since steps pass in order. One without a definition counts pages.
 */
export const bannerOf = (
  t: BannerItem,
  /** What the ladder says of it before a start and once done */
  ladder?: { line: string; done: string }
): Banner => {
  const head = { id: t.id, title: t.title };
  const author = t.authors[0] && `by ${t.authors[0].name}`;
  const p = t.progress;

  if (p.state === "completed") {
    return {
      ...head,
      state: "completed",
      label: "Completed",
      // The ladder's headline, else the definition's without its full stop
      line:
        ladder?.done ?? (t.lesson?.finish.replace(/\.$/, "") || t.description),
      action: "Open again",
    };
  }
  if (p.state === "started") {
    const meter = { done: p.page, of: p.pages };
    if (t.lesson) {
      // The step after the passed ones; the last once all passed but the
      // finish has not shown
      const n = Math.min(p.page + 1, p.pages);
      const next = t.lesson.objectives[n - 1];
      return {
        ...head,
        state: "started",
        label: `Continue · Step ${n} of ${p.pages}`,
        line: next ? `Next: ${next}` : t.description,
        meter,
        action: "Continue",
      };
    }
    return {
      ...head,
      state: "started",
      label: `Continue · Page ${p.page} of ${p.pages}`,
      line: t.description,
      meter,
      action: "Continue",
    };
  }
  const size = t.lesson
    ? [`${t.lesson.minutes} min`, `${t.pages} steps`]
    : [`${t.pages} pages`];
  const phoneSize = t.lesson
    ? [`${t.pages} steps`, `${t.lesson.minutes} min`]
    : [`${t.pages} pages`];
  return {
    ...head,
    state: "fresh",
    label: "Start here",
    line: ladder?.line ?? t.description,
    meta: [...size, t.level, t.framework, author].filter(Boolean).join(" · "),
    phoneMeta: [t.level, ...phoneSize].join(" · "),
    action: "Start",
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/catalog/model/banner", () => {
    type Progress = BannerItem["progress"];

    const helloAnchor = (progress: Progress): BannerItem => ({
      id: "Hello Anchor",
      title: "Hello Anchor",
      description: "Hello world program with Anchor framework.",
      level: "Beginner",
      framework: "Anchor",
      authors: [{ name: "acheron" }],
      progress,
      pages: 4,
      lesson: {
        minutes: 10,
        objectives: ["Write it", "Deploy it", "Call it", "Name it"],
        finish: "You built and called your first Solana program.",
      },
    });

    const lumberjack = (progress: Progress): BannerItem => ({
      id: "Lumberjack",
      title: "Lumberjack",
      description: "How to build an energy system on chain.",
      level: "Intermediate",
      framework: "Anchor",
      authors: [{ name: "Jonas Hahn" }],
      progress,
      pages: 3,
      lesson: undefined,
    });

    const NEW: Progress = { state: "new" };
    const DONE: Progress = { state: "completed" };

    it("invites a first start of Hello Anchor", () => {
      expect(
        bannerOf(helloAnchor(NEW), {
          line: "Write, deploy and call your first program",
          done: "You built and called your first Solana program",
        })
      ).toEqual({
        id: "Hello Anchor",
        title: "Hello Anchor",
        state: "fresh",
        label: "Start here",
        line: "Write, deploy and call your first program",
        meta: "10 min · 4 steps · Beginner · Anchor · by acheron",
        phoneMeta: "Beginner · 4 steps · 10 min",
        action: "Start",
      });
    });

    it("picks up Hello Anchor half done at the step after the passed ones", () => {
      const b = bannerOf(helloAnchor({ state: "started", page: 2, pages: 4 }));
      expect(b.label).toBe("Continue · Step 3 of 4");
      expect(b.line).toBe("Next: Call it");
      expect(b.state === "started" && b.meter).toEqual({ done: 2, of: 4 });
      expect(b.action).toBe("Continue");
    });

    it("stays on the last step once every step passed but the finish has not shown", () => {
      const b = bannerOf(helloAnchor({ state: "started", page: 4, pages: 4 }));
      expect(b.label).toBe("Continue · Step 4 of 4");
    });

    it("counts pages for a tutorial without a definition", () => {
      const fresh = bannerOf(lumberjack(NEW));
      expect(fresh.state === "fresh" && fresh.meta).toBe(
        "3 pages · Intermediate · Anchor · by Jonas Hahn"
      );
      const b = bannerOf(lumberjack({ state: "started", page: 2, pages: 3 }));
      expect(b.label).toBe("Continue · Page 2 of 3");
      expect(b.line).toBe("How to build an energy system on chain.");
    });

    it("says completed with the finish headline and only Open again", () => {
      const b = bannerOf(helloAnchor(DONE));
      expect(b.label).toBe("Completed");
      expect(b.line).toBe("You built and called your first Solana program");
      expect(b.action).toBe("Open again");
      expect(b.state).toBe("completed");
    });

    it("says the ladder's headline once a lesson without a definition is done", () => {
      expect(
        bannerOf(lumberjack(DONE), {
          line: "Keep a player's state on chain and refill energy over time",
          done: "You built an energy system on chain",
        }).line
      ).toBe("You built an energy system on chain");
    });

    it("falls back to the description where the definition says nothing", () => {
      expect(bannerOf(lumberjack(DONE)).line).toBe(
        "How to build an energy system on chain."
      );
      // A save with more steps than the definition now has: no objective
      expect(
        bannerOf(helloAnchor({ state: "started", page: 5, pages: 6 })).line
      ).toBe("Hello world program with Anchor framework.");
    });

    it("features the first of the ladder not completed, else the last", () => {
      const a = helloAnchor(DONE);
      const l = lumberjack(NEW);
      expect(featuredOf([a, l])?.id).toBe("Lumberjack");
      expect(featuredOf([a, lumberjack(DONE)])?.id).toBe("Lumberjack");
      expect(featuredOf([helloAnchor(NEW), l])?.id).toBe("Hello Anchor");
      expect(featuredOf([])).toBeUndefined();
    });
  });
}
