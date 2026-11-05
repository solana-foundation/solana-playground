import type { TutorialProgress } from "@/entities/tutorial";
import { useTutorialProgress } from "@/entities/tutorial";
import type { TutorialData } from "@/utils";
import { PgTutorial } from "@/utils";

import { matchesTutorial } from "../lib/filter";
import type { CardOpen } from "../ui/BaseCatalogGrid";
import type { CardList, CardOpenOf } from "./lists";

/** One tutorial as its card and the Start here banner draw it */
export interface TutorialItem {
  /** What `onOpen` is called with: the tutorial's name */
  id: string;
  title: string;
  description: string;
  framework?: TutorialData["framework"];
  level: TutorialData["level"];
  authors: TutorialData["authors"];
  progress: TutorialProgress;
  /** Its pages, or a conversation tutorial's steps */
  pages: number;
  /** What a conversation tutorial's definition says; none without one */
  lesson?: {
    minutes: number;
    /** Each step's objective, in order */
    objectives: string[];
    /** The finish card's headline */
    finish: string;
  };
  /** This card's Open, while it runs or once it failed; none otherwise */
  open?: CardOpen;
}

const plain = (text: string | { text: string }) =>
  typeof text === "string" ? text : text.text;

/**
 * The tutorials of `pool` (every registered one by default) with how far the
 * user is through each, searched by name and description. `count` is the
 * pool's size.
 */
export const useTutorialList = (
  query: string,
  cardOpen: CardOpenOf,
  // eslint-disable-next-line layers/curry-order -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
  pool: readonly TutorialData[] = PgTutorial.all
  // eslint-disable-next-line max-params -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
): CardList<TutorialItem> => {
  const progressFor = useTutorialProgress();
  return {
    list: {
      state: "ready",
      cards: pool
        .filter((t) => matchesTutorial(t, query))
        .map((t) => ({
          id: t.name,
          title: t.name,
          description: t.description,
          framework: t.framework,
          level: t.level,
          authors: t.authors,
          progress: progressFor(t.name),
          pages: t.pageCount,
          lesson: t.definition && {
            minutes: t.definition.minutes,
            objectives: t.definition.steps.map((s) => s.objective),
            finish: plain(t.definition.finish.headline),
          },
          open: cardOpen(t.name),
        })),
    },
    count: pool.length,
  };
};
