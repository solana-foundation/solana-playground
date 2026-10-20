import { useEffect, useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import { PgCommon } from "@/utils";

const log = createLogger("home:programs");

const PROGRAMS_URL = "/programs/programs.json";

/** How many programs the gallery lists; `null` while loading or when the list is missing */
export const useProgramCount = () => {
  const [programCount, setProgramCount] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    PgCommon.fetchJSON(PROGRAMS_URL)
      .then((programs: unknown) => {
        if (!Array.isArray(programs)) {
          throw new Error(`${PROGRAMS_URL} is not a list of programs`);
        }
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
