import { useState } from "react";

import { PgTutorial } from "@/utils";
import { useCardOpen } from "../model/use-card-open";
import { useSearchTelemetry } from "../model/use-search-telemetry";
import { useTutorialList } from "../model/use-tutorial-list";
import type { TutorialItem } from "../model/use-tutorial-list";
import type { CatalogCard, CatalogList } from "./BaseCatalogGrid";
import BaseCatalogPage from "./BaseCatalogPage";

// TODO(HOO-2254, tutorials-gallery-stand task 3): the page draws the
// tutorial card with its level groups; until then it keeps the catalog card
/** A tutorial as the catalog card draws it, with upstream's thumbnail */
const asCatalogCard = (t: TutorialItem): CatalogCard => ({
  id: t.id,
  title: t.title,
  description: t.description,
  media: PgTutorial.all.find((d) => d.name === t.id)?.thumbnail ?? "",
  tags: [{ label: t.level }, ...(t.framework ? [{ label: t.framework }] : [])],
  open: t.open,
});

const asCatalogList = (items: CatalogList<TutorialItem>): CatalogList =>
  items.state === "ready"
    ? { state: "ready", cards: items.cards.map(asCatalogCard) }
    : items;

/**
 * Every registered tutorial, searched by name and description. Open
 * navigates to the tutorial's route (`PgTutorial.open`); a failure there is
 * shown on the card, while what the route then fails to load is the
 * route's to report.
 */
const TutorialsPage = () => {
  const [query, setQuery] = useState("");
  const { open, busy, cardOpen } = useCardOpen("tutorials");
  const list = asCatalogList(useTutorialList(query, cardOpen).list);
  useSearchTelemetry(
    "tutorials",
    query,
    list.state === "ready" && list.cards.length === 0
  );

  return (
    <BaseCatalogPage
      label="tutorials"
      query={query}
      onQuery={setQuery}
      list={list}
      busy={busy}
      onOpen={(name) => open(name, () => PgTutorial.open(name))}
    />
  );
};

export default TutorialsPage;
