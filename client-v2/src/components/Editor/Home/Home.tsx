import { FC, useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import styled, { css } from "styled-components";

import { Button } from "@/shared/ui/button";
import Card from "../../Card";
import Img from "../../Img";
import Link from "../../Link";
import { getSrc } from "./platform-icon";
import { ResourceProps, RESOURCES } from "./resources";
import { TutorialProps, TUTORIALS } from "./tutorials";
import { External, ShortArrow } from "../../Icons";
import { PROJECT_NAME } from "../../../constants";
import { PgFramework, PgTheme, PgView } from "../../../utils";

const Home = () => {
  // This prevents unnecessarily fetching the home content for a frame when the
  // app is first mounted
  const [resources, setResources] = useState<ResourceProps[]>();
  useEffect(() => {
    setResources(
      PgFramework.all
        .filter((f) => f.docs)
        .map((f) => ({ ...f, ...f.docs } as ResourceProps))
        .concat(RESOURCES)
    );
  }, []);

  if (!resources) return null;

  return (
    <Wrapper id={PgView.ids.HOME}>
      <ProjectTitle>{PROJECT_NAME}</ProjectTitle>

      <ContentWrapper>
        <ResourcesWrapper>
          <ResourcesTitle>Resources</ResourcesTitle>
          <ResourceCardsWrapper>
            {resources.map((r, i) => (
              <Resource key={i} {...r} />
            ))}
          </ResourceCardsWrapper>
        </ResourcesWrapper>

        <TutorialsWrapper>
          <TutorialsTitle>Tutorials</TutorialsTitle>
          <TutorialCardsWrapper>
            {TUTORIALS.map((t, i) => (
              <Tutorial key={i} {...t} />
            ))}
          </TutorialCardsWrapper>

          <Button
            asChild
            variant="ghost"
            size="sm"
            className="mt-4 text-primary"
          >
            <RouterLink to="/tutorials">
              Playground tutorials
              <ShortArrow data-icon="inline-end" />
            </RouterLink>
          </Button>
        </TutorialsWrapper>
      </ContentWrapper>
    </Wrapper>
  );
};

const Wrapper = styled.div`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.views.main.primary.home.default)};
  `}
`;

const ProjectTitle = styled.div`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.views.main.primary.home.title)};
  `}
`;

const ContentWrapper = styled.div`
  display: flex;
  flex-wrap: wrap;
  width: 100%;
`;

const ResourcesWrapper = styled.div`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.views.main.primary.home.resources.default)};
  `}
`;

const ResourcesTitle = styled.div`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.views.main.primary.home.resources.title)};
  `}
`;

const ResourceCardsWrapper = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 2rem;
`;

const Resource: FC<React.PropsWithChildren<ResourceProps>> = ({
  name,
  description,
  url,
  icon,
  circleImage,
}) => (
  <ResourceCard>
    <ResourceTitle>
      <ResourceImg src={icon} $circleImage={circleImage} />
      {name}
    </ResourceTitle>
    <ResourceDescription>{description}</ResourceDescription>
    <ResourceButtonWrapper>
      <Button asChild variant="outline" className="w-full">
        <a href={url} target="_blank" rel="noopener noreferrer">
          Learn more
          <External data-icon="inline-end" />
        </a>
      </Button>
    </ResourceButtonWrapper>
  </ResourceCard>
);

const ResourceCard = styled(Card)`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(
      theme.views.main.primary.home.resources.card.default
    )};
  `}
`;

const ResourceTitle = styled.div`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.views.main.primary.home.resources.card.title)};
  `}
`;

const ResourceImg = styled(Img)<{ $circleImage?: boolean }>`
  ${({ theme, $circleImage }) => css`
    ${PgTheme.convertToCSS(theme.views.main.primary.home.resources.card.image)};

    ${$circleImage && "border-radius: 50%"};
  `};
`;

const ResourceDescription = styled.div`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(
      theme.views.main.primary.home.resources.card.description
    )};
  `}
`;

const ResourceButtonWrapper = styled.div`
  width: 100%;
  height: 20%;
`;

const TutorialsWrapper = styled.div`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.views.main.primary.home.tutorials.default)};
  `}
`;

const TutorialsTitle = styled.div`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.views.main.primary.home.tutorials.title)};
  `}
`;

const TutorialCardsWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

const Tutorial: FC<React.PropsWithChildren<TutorialProps>> = ({
  title,
  url,
}) => {
  const src = getSrc(url);

  return (
    <Link href={url}>
      <TutorialCard>
        {src && <TutorialIcon src={src} />}
        <TutorialTitle>{title}</TutorialTitle>
      </TutorialCard>
    </Link>
  );
};

const TutorialCard = styled(Card)`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.views.main.primary.home.tutorials.card)};
  `}
`;

const TutorialIcon = styled(Img)`
  height: 1rem;
  margin-right: 0.75rem;
`;

const TutorialTitle = styled.span``;

export default Home;
