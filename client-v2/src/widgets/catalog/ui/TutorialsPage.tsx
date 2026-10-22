import { useState } from "react";

import { levelVariant } from "@/shared/ui/tag";
import { PgTutorial } from "@/utils";
import { matchesTutorial } from "../lib/filter";
import { useCardOpen } from "../model/use-card-open";
import { useSearchTelemetry } from "../model/use-search-telemetry";
import BaseCatalogPage from "./BaseCatalogPage";
import type { CatalogCard } from "./BaseCatalogPage";

/**
 * Every registered tutorial, searched by name and description. Open
 * navigates to the tutorial's route (`PgTutorial.open`); a failure there is
 * shown on the card, while what the route then fails to load is the
 * route's to report.
 */
const TutorialsPage = () => {
  const [query, setQuery] = useState("");
  const { open, busy, cardOpen } = useCardOpen("tutorials");

  const cards: CatalogCard[] = PgTutorial.all
    .filter((t) => matchesTutorial(t, query))
    .map((t) => ({
      id: t.name,
      title: t.name,
      description: t.description,
      media: t.thumbnail,
      tags: [
        { label: t.level, variant: levelVariant(t.level) },
        ...(t.framework ? [{ label: t.framework }] : []),
      ],
      open: cardOpen(t.name),
    }));
  useSearchTelemetry("tutorials", query, cards.length === 0);

  return (
    <BaseCatalogPage
      label="tutorials"
      query={query}
      onQuery={setQuery}
      list={{ state: "ready", cards }}
      busy={busy}
      onOpen={(name) => open(name, () => PgTutorial.open(name))}
    />
  );
};

export default TutorialsPage;
