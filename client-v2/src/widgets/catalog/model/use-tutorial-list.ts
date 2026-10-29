import { useTutorialProgress } from "@/entities/tutorial";
import type { TutorialProgress } from "@/entities/tutorial";
import { PgTutorial } from "@/utils";
import type { TutorialData } from "@/utils";
import type { CardOpen } from "../ui/BaseCatalogGrid";
import { matchesTutorial } from "../lib/filter";
import type { CardList, CardOpenOf } from "./lists";

/** One tutorial as its card draws it */
export interface TutorialItem {
  /** What `onOpen` is called with: the tutorial's name */
  id: string;
  title: string;
  description: string;
  framework?: TutorialData["framework"];
  level: TutorialData["level"];
  authors: TutorialData["authors"];
  progress: TutorialProgress;
  /** This card's Open, while it runs or once it failed; none otherwise */
  open?: CardOpen;
}

/**
 * Every registered tutorial with how far the user is through it, searched
 * by name and description
 */
export const useTutorialList = (
  query: string,
  cardOpen: CardOpenOf
): CardList<TutorialItem> => {
  const progressFor = useTutorialProgress();
  return {
    list: {
      state: "ready",
      cards: PgTutorial.all
        .filter((t) => matchesTutorial(t, query))
        .map((t) => ({
          id: t.name,
          title: t.name,
          description: t.description,
          framework: t.framework,
          level: t.level,
          authors: t.authors,
          progress: progressFor(t.name),
          open: cardOpen(t.name),
        })),
    },
    count: PgTutorial.all.length,
  };
};
