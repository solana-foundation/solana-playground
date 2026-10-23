import { PgTutorial } from "@/utils";
import { matchesTutorial } from "../lib/filter";
import type { CardList, CardOpenOf } from "./lists";

/** Every registered tutorial as a card, searched by name and description */
export const useTutorialList = (
  query: string,
  cardOpen: CardOpenOf
): CardList => ({
  list: {
    state: "ready",
    cards: PgTutorial.all
      .filter((t) => matchesTutorial(t, query))
      .map((t) => ({
        id: t.name,
        title: t.name,
        description: t.description,
        media: t.thumbnail,
        tags: [
          { label: t.level },
          ...(t.framework ? [{ label: t.framework }] : []),
        ],
        open: cardOpen(t.name),
      })),
  },
  count: PgTutorial.all.length,
});
