import { useEffect, useRef, useState } from "react";

import { PgTutorial } from "@/utils";

import type { BaseNewProjectProps } from "../ui/BaseNewProject";
import { toastOpenFailed, toastStartFailed } from "../ui/open-failed-toast";
import { importProgram, isImportCancel } from "./program-open";
import type { CatalogPage } from "./telemetry";
import { catalogTelemetry } from "./telemetry";
import { useCardOpen } from "./use-card-open";
import { useProgramList } from "./use-program-list";
import { useTutorialList } from "./use-tutorial-list";

/** New project's state, held by its page and drawn by `NewProject` */
export interface NewProjectState {
  /** Everything `BaseNewProject` takes but Start from scratch */
  view: Omit<BaseNewProjectProps, "scratch">;
  /** An Open runs: Start from scratch waits too */
  busy: boolean;
  /** Start from scratch reports its own run here, so the cards wait on it */
  onStarting: (starting: boolean) => void;
  /** Start from scratch's failure: a toast once the page was left */
  onStartFailed: (message: string) => void;
  /** Closes the page */
  closePage: () => void;
}

/**
 * New project's state, held by its page. Whatever opens or starts from here
 * closes the page (`close`), if this visit still shows it. A failure stays where it happened, or comes up
 * as a toast where nothing shows it: the page was left, or the failing card's
 * list is not the one shown. One Open or Start at a time across both lists.
 */
export const useNewProject = (
  close: () => void,
  initialTab: CatalogPage = "tutorials"
): NewProjectState => {
  // Tutorials lead: a verified path is what this fork is for
  const [tab, setTab] = useState<CatalogPage>(initialTab);
  const [query, setQuery] = useState("");
  const [starting, setStarting] = useState(false);

  // Whether the page still shows: once it is left, no card is left
  // to show a failure
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  // The tab shown when an Open fails, not when it started: a ref, since the
  // Open's callbacks are the render's that started it
  const shown = useRef(tab);
  shown.current = tab;
  // Only this visit closes the page: an Open from an earlier one that ends
  // after the page was left and opened again must not close the new visit
  const closeIfOpen = () => {
    if (open.current) close();
  };
  const failedOn = (list: CatalogPage) => (message: string) => {
    if (!open.current || shown.current !== list) toastOpenFailed(message);
  };

  const tutorialOpen = useCardOpen("tutorials", {
    onOpened: closeIfOpen,
    onFailed: failedOn("tutorials"),
  });
  const programOpen = useCardOpen("programs", {
    isCancel: isImportCancel,
    onOpened: closeIfOpen,
    onFailed: failedOn("programs"),
  });
  const busy = tutorialOpen.busy || programOpen.busy;
  const tutorials = useTutorialList(query, tutorialOpen.cardOpen);
  const programs = useProgramList(query, programOpen.cardOpen);
  const held = busy || starting;
  // Each list refuses its own second Open; this refuses the other's while
  // one runs, and any while Start runs
  const unlessHeld =
    (openProject: (id: string) => Promise<void>) => async (id: string) => {
      if (!held) await openProject(id);
    };

  return {
    view: {
      tab,
      onTab: (next) => {
        catalogTelemetry.track("catalog_tab_switched", { tab: next });
        setTab(next);
      },
      counts: {
        tutorials: tutorials.count,
        programs: programs.count,
      },
      query,
      onQuery: setQuery,
      tutorials: {
        items: tutorials.list,
        busy: held,
        onOpen: unlessHeld((name) =>
          tutorialOpen.open(name, () => PgTutorial.open(name))
        ),
      },
      grid: {
        list: programs.list,
        busy: held,
        onOpen: unlessHeld((repo) =>
          programOpen.open(repo, importProgram(repo))
        ),
      },
    },
    busy,
    onStarting: setStarting,
    // Start sits above both lists, so only a left page hides its failure
    onStartFailed: (message) => {
      if (!open.current) toastStartFailed(message);
    },
    closePage: closeIfOpen,
  };
};
