import type { ReactNode } from "react";

import { catalogPage } from "../model/catalog-page";
import type { CatalogPage } from "../model/telemetry";
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
  CatalogPage,
  { title: string; hasOwnHeading: boolean; content: () => ReactNode }
> = {
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
export const catalogSlot = (
  page: CatalogPage | null
): CatalogSlot | undefined =>
  page === null
    ? undefined
    : {
        title: PAGES[page].title,
        hasOwnHeading: PAGES[page].hasOwnHeading,
        content: PAGES[page].content(),
        onClose: catalogPage.close,
      };
