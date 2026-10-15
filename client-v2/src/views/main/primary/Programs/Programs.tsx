import { FC } from "react";
import styled, { css } from "styled-components";

import ResponsiveItems from "../../../../components/ResponsiveItems";
import SearchBar from "../../../../components/SearchBar";
import Topbar from "../../../../components/Topbar";
import ProgramCard, { ProgramCardProps } from "./ProgramCard";
import { FrownIcon } from "lucide-react";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { Filter, useFilteredSearch } from "../../../../hooks";

interface ProgramsProps {
  programs: ProgramCardProps[];
  filters: Filter[];
}

const Programs: FC<React.PropsWithChildren<ProgramsProps>> = ({
  programs,
  filters,
}) => {
  const filteredSearch = useFilteredSearch({
    route: "/programs",
    items: programs,
    filters,
    sort: (a, b) => a.name.localeCompare(b.name),
  });
  if (!filteredSearch) return null;

  const { regularItems, searchBarProps } = filteredSearch;

  return (
    <Wrapper>
      <TopSection>
        <Title>Programs</Title>
        <SearchBar
          {...searchBarProps}
          placeholder="Search programs"
          searchButton={{ position: "right", width: "2.5rem" }}
        />
      </TopSection>

      <MainSection noMatch={!regularItems.length}>
        {regularItems.length ? (
          <ResponsiveItems minItemWidth="27.5rem" gap="1.5rem" maxItems={2}>
            {regularItems.map((p) => (
              <ProgramCard key={p.name} {...p} />
            ))}
          </ResponsiveItems>
        ) : (
          <Callout className="flex h-20 w-84 items-center justify-center gap-2.5 text-sm *:[svg]:translate-y-0">
            <FrownIcon />
            <CalloutDescription>No match found</CalloutDescription>
          </Callout>
        )}
      </MainSection>
    </Wrapper>
  );
};

const Wrapper = styled.div`
  ${({ theme }) => css`
    display: flex;
    flex-direction: column;
    font-family: ${theme.font.other.family};
    font-size: ${theme.font.other.size.medium};
  `}
`;

const TopSection = styled(Topbar)`
  height: 4.5rem;
  padding: 1rem 2.5rem;

  & > div {
    width: max(12rem, 50%);
  }
`;

const Title = styled.h1``;

const MainSection = styled.div<{ noMatch: boolean }>`
  ${({ noMatch }) => css`
    flex: 1;
    display: flex;
    padding: 2rem 2.5rem;

    ${noMatch && "justify-content: center; align-items: center;"}
  `}
`;

export default Programs;
