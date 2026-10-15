import { useEffect, useState } from "react";
import styled, { css } from "styled-components";

import type { ProgramListing } from "./ProgramsTab";
import ProgramsTab from "./ProgramsTab";
import StartFromScratch from "./StartFromScratch";
import TutorialsTab, { Empty } from "./TutorialsTab";
import { Button } from "@/shared/ui/button";
import { createLogger } from "../../../shared/lib/logger";
import { ModalFrame } from "@/widgets/overlays";
import { PgCommon, PgTutorial } from "../../../utils";

/** The gallery's two sources, one tab each */
export type GalleryTab = "programs" | "tutorials";

type Registry =
  | { status: "loading" }
  | { status: "ready"; programs: ProgramListing[] }
  | { status: "failed" };

const log = createLogger("gallery:programs");

const PROGRAMS_URL = "/programs/programs.json";

/**
 * The "What do you want to build?" gallery: the entry point for a new (or
 * empty) project. One decisive action up top (start from scratch), then two
 * real catalogs underneath -- the same tutorials and ecosystem programs the
 * sidebar pages already list, opened through their existing mechanisms
 * (`PgTutorial.open`, `PgGithub.import`) so nothing about how a project gets
 * created is reinvented here.
 */
const NewWorkspaceModal = ({
  initialTab = "tutorials",
}: {
  initialTab?: GalleryTab;
}) => {
  // Tutorials lead: a verified path is what this fork is for, and a gallery
  // opening on the program list buries it behind a tab nobody clicks
  const [tab, setTab] = useState<GalleryTab>(initialTab);
  const [query, setQuery] = useState("");
  const [registry, setRegistry] = useState<Registry>({ status: "loading" });
  // Bumped by Retry to run the fetch again
  const [attempt, setAttempt] = useState(0);

  // Fetched once per time the modal opens (this component only exists while
  // the modal is mounted), mirroring how `routes/programs/programs.tsx`
  // loads the same file.
  useEffect(() => {
    let live = true;
    setRegistry({ status: "loading" });
    PgCommon.fetchJSON(PROGRAMS_URL)
      .then((programs: ProgramListing[]) => {
        if (live) setRegistry({ status: "ready", programs });
      })
      .catch((e: unknown) => {
        // An empty list would read as "no programs exist"; say it failed
        log.error(e, { report: true, context: { url: PROGRAMS_URL } });
        if (live) setRegistry({ status: "failed" });
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  const programs = registry.status === "ready" ? registry.programs : null;
  const programCount = {
    loading: "...",
    ready: programs?.length,
    failed: "?",
  }[registry.status];

  const tutorialCount = PgTutorial.all.length;

  return (
    <ModalFrame
      name="new-workspace"
      title="What do you want to build?"
      size="wide"
    >
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
              <Count>{programCount}</Count>
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
          {tab === "tutorials" && <TutorialsTab query={query} />}
          {tab === "programs" && registry.status !== "failed" && (
            <ProgramsTab query={query} programs={programs} />
          )}
          {tab === "programs" && registry.status === "failed" && (
            <Empty>
              Could not load the programs.{" "}
              <Button
                type="button"
                variant="secondary"
                onClick={() => setAttempt(attempt + 1)}
              >
                Retry
              </Button>
            </Empty>
          )}
        </Panel>
      </Wrapper>
    </ModalFrame>
  );
};

export default NewWorkspaceModal;

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
