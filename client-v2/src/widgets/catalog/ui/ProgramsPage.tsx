import { useEffect, useState } from "react";

import { fetchPrograms, PROGRAMS_URL } from "@/entities/program";
import type { ProgramListing } from "@/entities/program";
import { createLogger } from "@/shared/lib/logger";
import { ImportCancelledError, PgGithub } from "@/utils";
import type { ImportProgress } from "@/utils";
import { matchesProgram } from "../lib/filter";
import { useCardOpen } from "../model/use-card-open";
import { useSearchTelemetry } from "../model/use-search-telemetry";
import BaseCatalogPage from "./BaseCatalogPage";
import type { CatalogList } from "./BaseCatalogPage";

const listLog = createLogger("catalog:programs");

type Listing =
  | { state: "loading" }
  | { state: "ready"; programs: ProgramListing[] }
  | { state: "failed" };

/** Where an import is, in the user's terms */
const progressText = ({ loaded, total }: ImportProgress) =>
  total === null
    ? "Reading the repository…"
    : `Downloading ${loaded}/${total} files…`;

/** Closing the program selection is a choice, not a failure */
const isCancel = (e: unknown) => e instanceof ImportCancelledError;

/**
 * The ecosystem programs (`PROGRAMS_URL`), searched by name, description and
 * category. Open imports the repository as a project (`PgGithub.import`).
 */
const ProgramsPage = () => {
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [listing, setListing] = useState<Listing>({ state: "loading" });
  const { open, busy, cardOpen } = useCardOpen("programs", isCancel);

  useEffect(() => {
    let live = true;
    setListing({ state: "loading" });
    fetchPrograms()
      .then((programs) => {
        if (live) setListing({ state: "ready", programs });
      })
      .catch((e: unknown) => {
        listLog.error(e, {
          report: true,
          context: { url: PROGRAMS_URL, attempt },
        });
        if (live) setListing({ state: "failed" });
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  let list: CatalogList;
  if (listing.state === "ready") {
    list = {
      state: "ready",
      cards: listing.programs
        .filter((p) => matchesProgram(p, query))
        .map((p) => ({
          id: p.repo,
          title: p.name,
          description: p.description,
          media: p.icon,
          tags: [
            { label: p.framework },
            ...p.categories.map((label) => ({ label })),
          ],
          open: cardOpen(p.repo),
        })),
    };
  } else if (listing.state === "failed") {
    list = {
      state: "failed",
      message: "Could not load the programs.",
      onRetry: () => setAttempt((n) => n + 1),
    };
  } else {
    list = { state: "loading" };
  }
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
      onOpen={(repo) =>
        open(repo, (report) =>
          PgGithub.import(repo, (next) => report(progressText(next)))
        )
      }
    />
  );
};

export default ProgramsPage;
