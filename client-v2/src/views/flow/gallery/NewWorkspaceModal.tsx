import { useEffect, useState } from "react";
import styled, { createGlobalStyle, css } from "styled-components";

import type { ProgramListing } from "./ProgramsTab";
import ProgramsTab from "./ProgramsTab";
import StartFromScratch from "./StartFromScratch";
import TutorialsTab from "./TutorialsTab";
import Modal from "../../../components/Modal";
import { PgCommon, PgTutorial } from "../../../utils";

type Tab = "programs" | "tutorials";

const PROGRAMS_URL = "/programs/programs.json";

/**
 * The "What do you want to build?" gallery: the entry point for a new (or
 * empty) project. One decisive action up top (start from scratch), then two
 * real catalogs underneath -- the same tutorials and ecosystem programs the
 * sidebar pages already list, opened through their existing mechanisms
 * (`PgTutorial.open`, `PgGithub.import`) so nothing about how a project gets
 * created is reinvented here.
 */
const NewWorkspaceModal = () => {
  // Tutorials lead: a verified path is what this fork is for, and a gallery
  // opening on the program list buries it behind a tab nobody clicks
  const [tab, setTab] = useState<Tab>("tutorials");
  const [query, setQuery] = useState("");
  const [programs, setPrograms] = useState<ProgramListing[] | null>(null);

  // Fetched once per time the modal opens (this component only exists while
  // the modal is mounted), mirroring how `routes/programs/programs.tsx`
  // loads the same file.
  useEffect(() => {
    let live = true;
    PgCommon.fetchJSON(PROGRAMS_URL)
      .then((data: ProgramListing[]) => {
        if (live) setPrograms(data);
      })
      .catch(() => {
        if (live) setPrograms([]);
      });
    return () => {
      live = false;
    };
  }, []);

  const tutorialCount = PgTutorial.all.length;

  return (
    <Modal title="What do you want to build?" closeButton>
      <ModalWidthOverride />
      <Wrapper data-gallery-modal>
        <Lead>
          Start clean, open a real program, or learn through a tutorial.
          Everything stays in this browser until you deploy.
        </Lead>

        <StartFromScratch />

        <Bar>
          <Tabs role="tablist" aria-label="Gallery source">
            <TabButton
              type="button"
              role="tab"
              id="gallery-tab-tutorials"
              aria-selected={tab === "tutorials"}
              aria-controls="gallery-panel"
              $active={tab === "tutorials"}
              onClick={() => setTab("tutorials")}
            >
              Tutorials
              <Count>{tutorialCount}</Count>
            </TabButton>
            <TabButton
              type="button"
              role="tab"
              id="gallery-tab-programs"
              aria-selected={tab === "programs"}
              aria-controls="gallery-panel"
              $active={tab === "programs"}
              onClick={() => setTab("programs")}
            >
              Programs
              <Count>{programs ? programs.length : "..."}</Count>
            </TabButton>
          </Tabs>

          <Search
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${tab}`}
            aria-label={`Search ${tab}`}
          />
        </Bar>

        <Panel
          id="gallery-panel"
          role="tabpanel"
          aria-labelledby={`gallery-tab-${tab}`}
        >
          {tab === "programs" ? (
            <ProgramsTab query={query} programs={programs} />
          ) : (
            <TutorialsTab query={query} />
          )}
        </Panel>
      </Wrapper>
    </Modal>
  );
};

export default NewWorkspaceModal;

/**
 * `components/Modal`'s outer chrome hardcodes `max-width: max(40%, 40rem)`
 * (`utils/theme/theme.ts`) with no prop to override it, and that file is
 * out of scope to edit here. This gallery needs a real multi-column grid,
 * so widen precisely the one element that is exactly three direct-child
 * hops above our own marker (Modal wrapper -> its scroll region -> its
 * content region -> `[data-gallery-modal]`) -- nothing else on the page can
 * match that shape, so every other modal in the app is unaffected.
 */
const ModalWidthOverride = createGlobalStyle`
  :has(> * > * > [data-gallery-modal]) {
    width: min(64rem, 90vw) !important;
    max-width: min(64rem, 90vw) !important;
  }
`;

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1.125rem;
`;

const Lead = styled.p`
  ${({ theme }) => css`
    margin: 0;
    color: ${theme.colors.default.textSecondary};
  `}
`;

const Bar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
`;

const Tabs = styled.div`
  ${({ theme }) => css`
    display: flex;
    padding: 0.25rem;
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
  `}
`;

const TabButton = styled.button<{ $active: boolean }>`
  ${({ theme, $active }) => css`
    display: flex;
    align-items: center;
    padding: 0.375rem 0.75rem;
    border: none;
    border-radius: calc(${theme.default.borderRadius} - 2px);
    background: ${$active ? theme.colors.default.bgSecondary : "transparent"};
    color: ${$active
      ? theme.colors.default.textPrimary
      : theme.colors.default.textSecondary};
    font: inherit;
    font-weight: ${$active ? 600 : 400};
    cursor: pointer;
    transition: background ${theme.default.transition.duration.short}
      ${theme.default.transition.type};

    &:hover {
      color: ${theme.colors.default.textPrimary};
    }
    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `}
`;

const Count = styled.span`
  ${({ theme }) => css`
    margin-left: 0.375rem;
    padding: 0 0.375rem;
    border-radius: 999px;
    background: ${theme.colors.default.bgPrimary};
    font-size: ${theme.font.other.size.xsmall};
    font-weight: 400;
    color: ${theme.colors.default.textSecondary};
  `}
`;

const Search = styled.input`
  ${({ theme }) => css`
    flex: 1;
    min-width: 10rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    background: ${theme.colors.default.bgPrimary};
    color: ${theme.colors.default.textPrimary};
    font: inherit;
    font-family: ${theme.font.other.family};

    &::placeholder {
      color: ${theme.colors.default.textSecondary};
    }
    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: 1px;
    }
  `}
`;

const Panel = styled.div`
  min-height: 8rem;
`;
