import { useEffect, useState } from "react";

import { fetchPrograms, PROGRAMS_URL } from "@/entities/program";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("home:programs");

/** How many programs the gallery lists; `null` while loading or when the list is missing */
export const useProgramCount = () => {
  const [programCount, setProgramCount] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    fetchPrograms()
      .then((programs) => {
        if (live) setProgramCount(programs.length);
      })
      .catch((e: unknown) => {
        // The count keeps its ellipsis; a missing or malformed list is not
        // news for the team, so it is logged without `report`
        log.error(e, { context: { url: PROGRAMS_URL } });
      });
    return () => {
      live = false;
    };
  }, []);

  return programCount;
};
