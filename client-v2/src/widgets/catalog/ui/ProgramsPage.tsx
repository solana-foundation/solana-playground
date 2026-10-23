import { useState } from "react";

import { useCardOpen } from "../model/use-card-open";
import { importProgram, isImportCancel } from "../model/program-open";
import { useProgramList } from "../model/use-program-list";
import { useSearchTelemetry } from "../model/use-search-telemetry";
import BaseCatalogPage from "./BaseCatalogPage";

/**
 * The ecosystem programs, searched by name, description and category. Open
 * imports the repository as a project (`PgGithub.import`).
 */
const ProgramsPage = () => {
  const [query, setQuery] = useState("");
  const { open, busy, cardOpen } = useCardOpen("programs", {
    isCancel: isImportCancel,
  });
  const { list } = useProgramList(query, cardOpen);
  useSearchTelemetry(
    "programs",
    query,
    list.state === "ready" && list.cards.length === 0
  );

  return (
    <BaseCatalogPage
      label="programs"
      query={query}
      onQuery={setQuery}
      list={list}
      busy={busy}
      onOpen={(repo) => open(repo, importProgram(repo))}
    />
  );
};

export default ProgramsPage;
