import { FC, useState } from "react";
import styled, { css } from "styled-components";

import {
  Body,
  Card,
  Empty,
  Eyebrow,
  ErrorText,
  Grid,
  Sub,
  Title,
} from "./TutorialsTab";
import Button from "../../../components/Button";
import Img from "../../../components/Img";
import { ImportCancelledError, PgGithub, PgView } from "../../../utils";
import type { ImportProgress } from "../../../utils";

/** One entry of `public/programs/programs.json`. */
export interface ProgramListing {
  name: string;
  description: string;
  repo: string;
  icon: string;
  framework: string;
  categories: string[];
}

interface ProgramsTabProps {
  /** Lowercased search query from the modal's search box */
  query: string;
  /** `null` while the JSON hasn't resolved yet */
  programs: ProgramListing[] | null;
}

/**
 * Lists the upstream ecosystem program registry (same data as the
 * `/programs` route). "Open" reuses the exact import path the rest of the
 * app already uses for a program card: `PgGithub.import`, which reads the
 * repo layout from the GitHub Trees API, converts it to the playground
 * layout, and creates (or switches to) a workspace named after the repo.
 */
const ProgramsTab: FC<React.PropsWithChildren<ProgramsTabProps>> = ({
  query,
  programs,
}) => {
  const [error, setError] = useState<{ repo: string; message: string } | null>(
    null
  );
  const [progress, setProgress] = useState<
    ({ repo: string } & ImportProgress) | null
  >(null);

  if (programs === null) {
    return <Empty>Loading programs...</Empty>;
  }

  const q = query.trim().toLowerCase();
  const items = q
    ? programs.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.categories.some((c) => c.toLowerCase().includes(q))
      )
    : programs;

  if (!items.length) {
    return <Empty>No programs match &ldquo;{query}&rdquo;.</Empty>;
  }

  return (
    <Grid>
      {items.map((p) => (
        <Card key={p.repo}>
          <Icon src={p.icon} alt="" />
          <Body>
            <Eyebrow>
              {p.framework}
              {p.categories[0] ? ` \u00b7 ${p.categories[0]}` : ""}
            </Eyebrow>
            <Title>{p.name}</Title>
            <Sub>{p.description}</Sub>
            {error?.repo === p.repo && <ErrorText>{error.message}</ErrorText>}
            {progress?.repo === p.repo && (
              <ProgressText>{getProgressText(progress)}</ProgressText>
            )}
          </Body>
          <Button
            onClick={async () => {
              setError(null);
              setProgress({ repo: p.repo, loaded: 0, total: null });
              try {
                await PgGithub.import(p.repo, (next) => {
                  setProgress({ repo: p.repo, ...next });
                });
                PgView.setModal(null);
              } catch (e) {
                // Closing the program selection is a choice, not a failure
                if (!(e instanceof ImportCancelledError)) {
                  setError({
                    repo: p.repo,
                    message:
                      e instanceof Error ? e.message : "Could not open program",
                  });
                }
              } finally {
                setProgress(null);
              }
            }}
          >
            Open
          </Button>
        </Card>
      ))}
    </Grid>
  );
};

export default ProgramsTab;

/** Describe where the import currently is, in the user's terms. */
const getProgressText = ({ loaded, total }: ImportProgress) => {
  if (total === null) return "Reading the repository...";
  return `Downloading ${loaded}/${total} files...`;
};

const ProgressText = styled.div`
  ${({ theme }) => css`
    margin-top: 0.25rem;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.other.size.small};
  `}
`;

const Icon = styled(Img)`
  ${({ theme }) => css`
    width: 2.75rem;
    height: 2.75rem;
    border-radius: ${theme.default.borderRadius};
    background: ${theme.colors.default.bgSecondary};
  `}
`;
