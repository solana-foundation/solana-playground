import { FC } from "react";
import styled, { css } from "styled-components";

import List from "../../../../components/ResponsiveItems";
import SearchBar from "../../../../components/SearchBar";
import Topbar from "../../../../components/Topbar";
import FeaturedTutorial from "./FeaturedTutorial";
import TutorialCard from "./TutorialCard";
import { FrownIcon } from "lucide-react";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { Filter, useFilteredSearch } from "../../../../hooks";
import { TutorialFullData, TUTORIAL_LEVELS } from "../../../../utils";

interface TutorialsProps {
  tutorials: TutorialFullData[];
  filters: Filter[];
}

const Tutorials: FC<React.PropsWithChildren<TutorialsProps>> = ({
  tutorials,
  filters,
}) => {
  const filteredSearch = useFilteredSearch({
    route: "/tutorials",
    items: tutorials,
    filters,
    sort: (a, b) => {
      // Prioritize "Hello world" tutorials
      if (a.name.startsWith("Hello") && b.name.startsWith("Hello")) {
        return a.name.localeCompare(b.name);
      }
      if (a.name.startsWith("Hello")) return -1;
      if (b.name.startsWith("Hello")) return 1;

      // If different level, sort by level (beginner to advanced)
      if (a.level !== b.level) {
        return (
          TUTORIAL_LEVELS.indexOf(a.level) - TUTORIAL_LEVELS.indexOf(b.level)
        );
      }

      // Same level, sort by creation date (newest to oldest)
      return b.unixTimestamp - a.unixTimestamp;
    },
  });
  if (!filteredSearch) return null;

  const { featuredItems, regularItems, searchBarProps } = filteredSearch;

  return (
    <Wrapper>
      <TopSection>
        <Title>Learn</Title>
        <SearchBar
          {...searchBarProps}
          placeholder="Search tutorials"
          searchButton={{ position: "right", width: "2.5rem" }}
        />
      </TopSection>

      <MainSection noMatch={!featuredItems.length && !regularItems.length}>
        {featuredItems.length || regularItems.length ? (
          <List minItemWidth="16rem" gap="1rem" maxItems={4}>
            {regularItems.map((t) => (
              <TutorialCard key={t.name} {...t} />
            ))}
          </List>
        ) : (
          <Callout className="flex h-20 w-84 items-center justify-center gap-2.5 text-sm *:[svg]:translate-y-0">
            <FrownIcon />
            <CalloutDescription>No match found</CalloutDescription>
          </Callout>
        )}

        {featuredItems.length > 0 && (
          <FeaturedTutorial tutorial={featuredItems[0]} />
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
  z-index: 1;

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

export default Tutorials;
