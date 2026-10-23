import { useState } from "react";

import { PgTutorial } from "@/utils";
import { useCardOpen } from "../model/use-card-open";
import { useSearchTelemetry } from "../model/use-search-telemetry";
import { useTutorialList } from "../model/use-tutorial-list";
import BaseCatalogPage from "./BaseCatalogPage";

/**
 * Every registered tutorial, searched by name and description. Open
 * navigates to the tutorial's route (`PgTutorial.open`); a failure there is
 * shown on the card, while what the route then fails to load is the
 * route's to report.
 */
const TutorialsPage = () => {
  const [query, setQuery] = useState("");
  const { open, busy, cardOpen } = useCardOpen("tutorials");
  const { list } = useTutorialList(query, cardOpen);
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
