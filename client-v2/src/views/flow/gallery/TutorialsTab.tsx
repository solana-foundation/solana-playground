import { FC, useState } from "react";
import styled, { css } from "styled-components";

import Button from "../../../components/Button";
import Img from "../../../components/Img";
import { PgTheme, PgTutorial, PgView } from "../../../utils";

interface TutorialsTabProps {
  /** Lowercased search query from the modal's search box */
  query: string;
}

/**
 * Lists every registered tutorial (`PgTutorial.all`) filtered by `query`.
 * Opening one hands off to the existing tutorial route/flow, then closes
 * the gallery so the reader lands straight on the tutorial page.
 */
const TutorialsTab: FC<React.PropsWithChildren<TutorialsTabProps>> = ({
  query,
}) => {
  const [error, setError] = useState<{ name: string; message: string } | null>(
    null
  );

  const q = query.trim().toLowerCase();
  const items = q
    ? PgTutorial.all.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q)
      )
    : PgTutorial.all;

  if (!items.length) {
    return <Empty>No tutorials match &ldquo;{query}&rdquo;.</Empty>;
  }

  return (
    <Grid>
      {items.map((t) => (
        <Card key={t.name}>
          <Thumb src={t.thumbnail} alt="" />
          <Body>
            <Eyebrow>
              {t.level}
              {t.framework ? ` \u00b7 ${t.framework}` : ""}
            </Eyebrow>
            <Title>{t.name}</Title>
            <Sub>{t.description}</Sub>
            {error?.name === t.name && <ErrorText>{error.message}</ErrorText>}
          </Body>
          <Button
            onClick={async () => {
              setError(null);
              try {
                await PgTutorial.open(t.name);
                PgView.setModal(null);
              } catch (e) {
                setError({
                  name: t.name,
                  message:
                    e instanceof Error ? e.message : "Could not open tutorial",
                });
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

export default TutorialsTab;

/* Shared with ProgramsTab so both lists read as one family. */
export const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
  gap: 0.75rem;
`;

export const Card = styled.div`
  ${({ theme }) => css`
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.875rem;
    align-items: center;
    padding: 0.875rem;
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    background: ${theme.colors.default.bgPrimary};
    transition: border-color ${theme.default.transition.duration.short}
      ${theme.default.transition.type};

    &:hover {
      border-color: ${theme.colors.default.textSecondary};
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `}
`;

export const Body = styled.div`
  min-width: 0;
`;

export const Eyebrow = styled.div`
  ${({ theme }) => css`
    font-size: ${theme.font.other.size.xsmall};
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: ${theme.colors.default.primary};
  `}
`;

export const Title = styled.div`
  ${({ theme }) => css`
    margin-top: 0.125rem;
    font-weight: 600;
    color: ${theme.colors.default.textPrimary};
    ${PgTheme.getClampLinesCSS(1)};
  `}
`;

export const Sub = styled.div`
  ${({ theme }) => css`
    margin-top: 0.25rem;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.other.size.small};
    ${PgTheme.getClampLinesCSS(2)};
  `}
`;

/* Shared with ProgramsTab: an inline failure right at the card that
 * caused it, e.g. a GitHub rate limit or a missing tutorial asset. */
export const ErrorText = styled.div`
  ${({ theme }) => css`
    margin-top: 0.25rem;
    color: ${theme.colors.state.error.color};
    font-size: ${theme.font.other.size.small};
  `}
`;

export const Empty = styled.p`
  ${({ theme }) => css`
    margin: 1.5rem 0;
    text-align: center;
    color: ${theme.colors.default.textSecondary};
  `}
`;

const Thumb = styled(Img)`
  ${({ theme }) => css`
    width: 4.5rem;
    height: 3.375rem;
    object-fit: cover;
    border-radius: calc(${theme.default.borderRadius} - 2px);
    background: ${theme.colors.default.bgSecondary};
  `}
`;
