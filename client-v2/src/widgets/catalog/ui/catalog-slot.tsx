import type { ReactNode } from "react";

import { catalogPage } from "../model/catalog-page";
import type { CatalogPage } from "../model/telemetry";
import ProgramsPage from "./ProgramsPage";
import TutorialsPage from "./TutorialsPage";

/** What the layout shell's `cover` takes */
export interface CatalogSlot {
  title: string;
  content: ReactNode;
  onClose: () => void;
}

const PAGES: Record<CatalogPage, { title: string; content: () => ReactNode }> =
  {
    tutorials: { title: "Tutorials", content: () => <TutorialsPage /> },
    programs: { title: "Programs", content: () => <ProgramsPage /> },
  };

/** The page shown, for the layout shell's `cover`; none while no page shows */
export const catalogSlot = (
  page: CatalogPage | null
): CatalogSlot | undefined =>
  page === null
    ? undefined
    : {
        title: PAGES[page].title,
        content: PAGES[page].content(),
        onClose: catalogPage.close,
      };
