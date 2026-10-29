import { useEffect, useState } from "react";

import { fetchPrograms, PROGRAMS_URL } from "@/entities/program";
import type { ProgramListing } from "@/entities/program";
import { createLogger } from "@/shared/lib/logger";
import { matchesProgram } from "../lib/filter";
import type { CardList, CardOpenOf } from "./lists";

const listLog = createLogger("catalog:programs");

type Listing =
  | { state: "loading" }
  | { state: "ready"; programs: ProgramListing[] }
  | { state: "failed" };

/**
 * The ecosystem programs (`PROGRAMS_URL`) as cards, searched by name,
 * description and category. Read once per mount; Retry reads it again.
 */
export const useProgramList = (
  query: string,
  cardOpen: CardOpenOf
): CardList => {
  const [attempt, setAttempt] = useState(0);
  const [listing, setListing] = useState<Listing>({ state: "loading" });

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

  if (listing.state === "loading") {
    return { list: { state: "loading" }, count: "loading" };
  }
  if (listing.state === "failed") {
    return {
      list: {
        state: "failed",
        message: "Could not load the programs.",
        onRetry: () => setAttempt((n) => n + 1),
      },
      count: "failed",
    };
  }
  return {
    list: {
      state: "ready",
      cards: listing.programs
        .filter((p) => matchesProgram(p, query))
        .map((p) => ({
          id: p.repo,
          title: p.name,
          description: p.description,
          media: p.icon,
          // Only the first category shows, as on the prototype's cards, so
          // the line stays one line. Search still matches every category
          // (`matchesProgram`)
          tags: [
            { label: p.framework },
            ...p.categories.slice(0, 1).map((label) => ({ label })),
          ],
          open: cardOpen(p.repo),
        })),
    },
    count: listing.programs.length,
  };
};
