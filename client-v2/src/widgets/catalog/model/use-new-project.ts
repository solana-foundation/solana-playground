import { useEffect, useRef, useState } from "react";

import { PgTutorial } from "@/utils";
import type { BaseNewProjectProps } from "../ui/BaseNewProject";
import { importProgram, isImportCancel } from "./program-open";
import { catalogTelemetry } from "./telemetry";
import type { CatalogPage } from "./telemetry";
import { useCardOpen } from "./use-card-open";
import { useProgramList } from "./use-program-list";
import { useTutorialList } from "./use-tutorial-list";
import { toastOpenFailed } from "../ui/open-failed-toast";

/** New project's state, held by its dialog and drawn by `NewProject` */
export interface NewProjectState {
  /** Everything `BaseNewProject` takes but Start from scratch */
  view: Omit<BaseNewProjectProps, "scratch">;
  /** An Open runs: Start from scratch waits too */
  busy: boolean;
  /** Start from scratch reports its own run here, so the cards wait on it */
  onStarting: (starting: boolean) => void;
  /** Closes this dialog, if it is still open */
  closeDialog: () => void;
}

/**
 * New project's state. Call it in the dialog's component, above its
 * `ModalFrame`: a dialog stacked on this one (an import's program picker)
 * remounts everything under the frame, and the Open that dialog belongs to
 * must still be known when it finishes. Whatever opens or starts from here
 * closes the dialog (`close`, which closes this dialog by its id and so
 * never another); a failure stays where it happened, or, once the dialog was
 * dismissed, comes up as a toast. One Open or Start at a time across both
 * lists.
 */
export const useNewProject = (
  close: () => void,
  initialTab: CatalogPage = "tutorials"
): NewProjectState => {
  // Tutorials lead: a verified path is what this fork is for
  const [tab, setTab] = useState<CatalogPage>(initialTab);
  const [query, setQuery] = useState("");
  const [starting, setStarting] = useState(false);

  // Whether this dialog is still open: once it is dismissed, no card is left
  // to show a failure
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const onFailed = (message: string) => {
    if (!open.current) toastOpenFailed(message);
  };

  const tutorialOpen = useCardOpen("tutorials", {
    onOpened: close,
    onFailed,
  });
  const programOpen = useCardOpen("programs", {
    isCancel: isImportCancel,
    onOpened: close,
    onFailed,
  });
  const busy = tutorialOpen.busy || programOpen.busy;
  const tutorials = useTutorialList(query, tutorialOpen.cardOpen);
  const programs = useProgramList(query, programOpen.cardOpen);
  const held = busy || starting;
  // Each list refuses its own second Open; this refuses the other's while
  // one runs, and any while Start runs
  const unlessHeld =
    (open: (id: string) => Promise<void>) => async (id: string) => {
      if (!held) await open(id);
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
    closeDialog: close,
  };
};
