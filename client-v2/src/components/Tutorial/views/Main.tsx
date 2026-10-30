import { FC, useEffect, useRef } from "react";
import styled, { css } from "styled-components";

import { Button } from "@/shared/ui/button";
import EditorWithTabs from "../../EditorWithTabs";
import Markdown from "../../Markdown";
import Resizable from "../../Resizable";
import { SpinnerWithBg } from "../../Loading";
import { PointedArrow } from "../../Icons";
import { Emoji } from "../../../constants";
import { useAsyncEffect } from "../../../hooks";
import {
  PgCommon,
  PgRouter,
  PgTheme,
  PgTutorial,
  PgView,
} from "../../../utils";
import type { TutorialMainComponentProps } from "../types";

export const Main: FC<React.PropsWithChildren<TutorialMainComponentProps>> = ({
  pageNumber,
  pages,
  layout = "editor-content",
  isStarted,
  onComplete,
  start,
}) => {
  // If the page is set from the URL but the tutorial has not been started,
  // start the tutorial automatically.
  //
  // TODO: Move this to the route handler. Currently, the user sees the sidebar
  // page for a short period of time before this effect runs.
  useAsyncEffect(async () => {
    if (isStarted) return;

    PgView.setSidebarLoading(true);
    try {
      await PgCommon.transition(start);
    } finally {
      PgView.setSidebarLoading(false);
    }
  }, [isStarted, start]);

  // Scroll to the top on page change
  const tutorialPageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tutorialPageRef.current?.scrollTo({ top: 0, left: 0 });
  }, [pageNumber]);

  // Specific page events. `onMount` may return anything: an arrow with an
  // expression body returns that expression (an assignment, the assigned
  // value), and an async hook returns a promise. React calls whatever the
  // effect returns as its cleanup, so only a function is passed on.
  useEffect(() => {
    const page = pages.at(pageNumber - 1);
    const cleanup = page?.onMount?.();
    if (typeof cleanup === "function") return cleanup;
  }, [pageNumber, pages]);

  const nextPage = () => {
    PgTutorial.openPage(pageNumber + 1);
  };

  const previousPage = () => {
    PgTutorial.openPage(pageNumber - 1);
  };

  const finishTutorial = () => {
    PgTutorial.finish();
    if (onComplete) onComplete();
  };

  const currentPage = pages.at(pageNumber - 1);
  if (!currentPage) {
    // This could happen if the saved page has been deleted
    PgTutorial.openPage(1);
    return null;
  }

  const currentContent = currentPage.content;
  const currentLayout = currentPage.layout ?? layout;

  return (
    <Wrapper>
      {currentLayout === "editor-content" && (
        <Resizable
          enable="right"
          defaultSize={{ width: "60%", height: "100%" }}
          minWidth="25%"
          maxWidth="75%"
        >
          {isStarted ? (
            <EditorWithTabs />
          ) : (
            <SpinnerWithBg loading size="2rem" />
          )}
        </Resizable>
      )}

      <TutorialPage ref={tutorialPageRef}>
        <TutorialContent>
          {typeof currentContent === "string" ? (
            <Markdown
              linkable
              rootSrc={PgRouter.location.pathname
                .split("/")
                .slice(0, 3)
                .join("/")}
            >
              {currentContent}
            </Markdown>
          ) : (
            currentContent
          )}

          <NavigationButtonsOutsideWrapper>
            <NavigationButtonsInsideWrapper>
              {pageNumber !== 1 && (
                <PreviousWrapper>
                  <PreviousText>Previous</PreviousText>
                  <Button
                    onClick={previousPage}
                    variant="ghost"
                    className={NAVIGATION_BUTTON}
                  >
                    <PointedArrow data-icon="inline-start" rotate="180deg" />
                    {pages[pageNumber - 2].title ??
                      `${pageNumber - 1}/${pages.length}`}
                  </Button>
                </PreviousWrapper>
              )}

              <NextWrapper>
                <NextText>Next</NextText>
                {pageNumber === pages.length ? (
                  <Button
                    onClick={finishTutorial}
                    variant="ghost"
                    className={`${NAVIGATION_BUTTON} text-success`}
                  >
                    Finish
                    <span data-icon="inline-end">{Emoji.CHECKMARK}</span>
                  </Button>
                ) : (
                  <Button
                    onClick={nextPage}
                    variant="ghost"
                    className={NAVIGATION_BUTTON}
                  >
                    {pages[pageNumber].title ??
                      `${pageNumber + 1}/${pages.length}`}
                    <PointedArrow data-icon="inline-end" />
                  </Button>
                )}
              </NextWrapper>
            </NavigationButtonsInsideWrapper>
          </NavigationButtonsOutsideWrapper>
        </TutorialContent>
      </TutorialPage>
    </Wrapper>
  );
};

const Wrapper = styled.div`
  display: flex;
  height: 100%;
`;

const TutorialPage = styled.div`
  ${({ theme }) => css`
    overflow: auto;
    max-width: 60rem;
    padding-top: ${theme.components.tabs.tab.default.height};
    background: ${theme.components.tutorial.default.bg};
  `}
`;

const TutorialContent = styled.div`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.components.tutorial.tutorialPage)};
  `}
`;

const NavigationButtonsOutsideWrapper = styled.div`
  padding: 3rem 0;
`;

const NavigationButtonsInsideWrapper = styled.div`
  ${({ theme }) => css`
    display: flex;
    width: 100%;
    padding-top: 1.5rem;
    border-top: 1px solid ${theme.colors.default.border};
    font-size: ${theme.font.other.size.small};
    font-weight: bold;
  `}
`;

const NAVIGATION_BUTTON =
  "mt-2 text-base font-bold [&_svg:not([class*='size-'])]:size-5";

const PreviousWrapper = styled.div`
  width: 100%;
`;

const PreviousText = styled.div``;

const NextWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  width: 100%;
`;

const NextText = styled.div``;
