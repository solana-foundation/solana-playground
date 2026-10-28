import { FC, useEffect, useRef } from "react";

import { Button } from "@/shared/ui/button";
import EditorWithTabs from "../../EditorWithTabs";
import Markdown from "../../Markdown";
import Resizable from "../../Resizable";
import { SpinnerWithBg } from "../../Loading";
import { PointedArrow } from "../../Icons";
import { Emoji } from "../../../constants";
import { useAsyncEffect } from "../../../hooks";
import { PgCommon, PgRouter, PgTutorial, PgView } from "../../../utils";
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

  // Specific page events
  useEffect(() => {
    const page = pages.at(pageNumber - 1);
    if (page?.onMount) return page.onMount();
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
    <div className="flex h-full">
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

      <div ref={tutorialPageRef} className="max-w-[60rem] overflow-auto pt-10">
        <div className="bg-surface-base p-8 font-sans text-[1rem]">
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

          <div className="py-12">
            <div className="flex w-full border-t border-border pt-6 text-[0.875rem] font-bold">
              {pageNumber !== 1 && (
                <div className="w-full">
                  <div>Previous</div>
                  <Button
                    onClick={previousPage}
                    variant="ghost"
                    className={NAVIGATION_BUTTON}
                  >
                    <PointedArrow data-icon="inline-start" rotate="180deg" />
                    {pages[pageNumber - 2].title ??
                      `${pageNumber - 1}/${pages.length}`}
                  </Button>
                </div>
              )}

              <div className="flex w-full flex-col items-end">
                <div>Next</div>
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const NAVIGATION_BUTTON =
  "mt-2 text-base font-bold [&_svg:not([class*='size-'])]:size-5";
