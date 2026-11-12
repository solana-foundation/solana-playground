import type { ReactNode } from "react";

import { catalogPage } from "../model/catalog-page";
import type { ShownPage } from "../model/telemetry";
import NewProjectPage from "./NewProjectPage";
import ProgramsPage from "./ProgramsPage";
import TutorialsPage from "./TutorialsPage";

/** What the layout shell's `cover` takes */
export interface CatalogSlot {
  title: string;
  /** The page draws its own large title, so a phone's bar names nothing */
  hasOwnHeading: boolean;
  content: ReactNode;
  onClose: () => void;
}

const PAGES: Record<
  ShownPage,
  { title: string; hasOwnHeading: boolean; content: () => ReactNode }
> = {
  "new-project": {
    title: "New project",
    hasOwnHeading: false,
    content: () => <NewProjectPage />,
  },
  tutorials: {
    title: "Tutorials",
    hasOwnHeading: true,
    content: () => <TutorialsPage />,
  },
  programs: {
    title: "Programs",
    hasOwnHeading: false,
    content: () => <ProgramsPage />,
  },
};

/** The page shown, for the layout shell's `cover`; none while no page shows */
export const catalogSlot = (page: ShownPage | null): CatalogSlot | undefined =>
  page === null
    ? undefined
    : {
        title: PAGES[page].title,
        hasOwnHeading: PAGES[page].hasOwnHeading,
        content: PAGES[page].content(),
        onClose: catalogPage.close,
      };
