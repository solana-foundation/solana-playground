import { FC, Fragment } from "react";
import { Link as RouterLink } from "react-router-dom";
import styled, { css } from "styled-components";

import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import Link from "../../Link";
import Markdown from "../../Markdown";
import TutorialDetails from "../TutorialDetails";
import { PointedArrow, Triangle } from "../../Icons";
import { Emoji } from "../../../constants";
import { PgTheme, PgTutorial } from "../../../utils";
import type { TutorialAboutComponentProps } from "../types";

export const About: FC<
  React.PropsWithChildren<TutorialAboutComponentProps>
> = ({ about, isStarted, start }) => {
  const tutorial = PgTutorial.current!;
  const isFinished = PgTutorial.completed;

  return (
    <Wrapper>
      <GoBackButtonWrapper>
        <Button asChild variant="ghost">
          <RouterLink to="/tutorials">
            <PointedArrow data-icon="inline-start" rotate="180deg" />
            Go back to tutorials
          </RouterLink>
        </Button>
      </GoBackButtonWrapper>

      <TutorialAboutPage>
        <GeneratedWrapper>
          <GeneratedTopWrapper>
            <GeneratedTopLeftWrapper>
              <TutorialName>{tutorial.name}</TutorialName>
              <TutorialAuthorsWrapper>
                <TutorialAuthorsByText>by </TutorialAuthorsByText>
                {tutorial.authors.length !== 0 &&
                  tutorial.authors.map((author, i) => (
                    <Fragment key={i}>
                      {i !== 0 && (
                        <TutorialAuthorSeperator>, </TutorialAuthorSeperator>
                      )}
                      {author.link ? (
                        <TutorialAuthorLink href={author.link}>
                          {author.name}
                        </TutorialAuthorLink>
                      ) : (
                        <TutorialAuthorWithoutLink>
                          {author.name}
                        </TutorialAuthorWithoutLink>
                      )}
                    </Fragment>
                  ))}
              </TutorialAuthorsWrapper>
            </GeneratedTopLeftWrapper>

            <GeneratedTopRightWrapper>
              <AsyncButton
                onClick={start}
                onError={reportButtonFailure}
                variant={isFinished ? "ghost" : "secondary"}
                className={isFinished ? "text-success" : undefined}
              >
                {isFinished ? (
                  <span data-icon="inline-start">{Emoji.CHECKMARK}</span>
                ) : (
                  <Triangle data-icon="inline-start" rotate="90deg" />
                )}
                {isFinished ? "COMPLETED" : isStarted ? "CONTINUE" : "START"}
              </AsyncButton>
            </GeneratedTopRightWrapper>
          </GeneratedTopWrapper>

          <GeneratedBottomWrapper>
            <TutorialDescription>{tutorial.description}</TutorialDescription>

            <TutorialDetails
              details={[
                { kind: "level", data: tutorial.level },
                { kind: "framework", data: tutorial.framework },
                { kind: "languages", data: tutorial.languages },
                // TODO: Enable once there are more tutorials with various categories
                // { kind: "categories", data: tutorial.categories },
              ]}
            />
          </GeneratedBottomWrapper>
        </GeneratedWrapper>

        <CustomWrapper>
          {typeof about === "string" ? (
            <Markdown linkable>{about}</Markdown>
          ) : (
            about
          )}
        </CustomWrapper>
      </TutorialAboutPage>
    </Wrapper>
  );
};

const Wrapper = styled.div`
  height: 100%;
  width: 100%;
  overflow: auto;
`;

const GoBackButtonWrapper = styled.div`
  display: flex;
  align-items: center;
  height: ${({ theme }) => theme.components.tabs.tab.default.height};
  padding-left: 1rem;
`;

const TutorialAboutPage = styled.div`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.components.tutorial.aboutPage)};
  `}
`;

const GeneratedWrapper = styled.div`
  padding: 1.5rem 0;
`;

const GeneratedTopWrapper = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const GeneratedTopLeftWrapper = styled.div``;

const TutorialName = styled.h1``;

const TutorialAuthorsWrapper = styled.div`
  ${({ theme }) => css`
    margin-top: 0.5rem;
    font-size: ${theme.font.other.size.small};
    color: ${theme.colors.default.textSecondary};
  `}
`;

const TutorialAuthorsByText = styled.span``;

const TutorialAuthorSeperator = styled.span``;

const TutorialAuthorLink = styled(Link)``;

const TutorialAuthorWithoutLink = styled.span``;

const GeneratedTopRightWrapper = styled.div``;

const GeneratedBottomWrapper = styled.div`
  margin-top: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

const TutorialDescription = styled.p`
  color: ${({ theme }) => theme.colors.default.textSecondary};
  line-height: 1.5;
`;

const CustomWrapper = styled.div``;
