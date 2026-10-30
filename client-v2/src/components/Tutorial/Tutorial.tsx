import { FC, useCallback, useEffect } from "react";
import styled, { css } from "styled-components";

import { About, Main } from "./views";
import { PgTheme, PgTutorial } from "../../utils";
import { useRenderOnChange } from "../../hooks";
import type { TutorialComponentProps } from "./types";

export const Tutorial: FC<React.PropsWithChildren<TutorialComponentProps>> = ({
  about,
  pages,
  files,
  defaultOpenFile,
  layout,
  onMount,
  onComplete,
}) => {
  useRenderOnChange(PgTutorial.onDidChange);

  const start = useCallback(
    () => PgTutorial.start({ files, defaultOpenFile }),
    [files, defaultOpenFile]
  );

  // On component mount. As with the page hooks in `Main`, only a function
  // `onMount` returns is a cleanup.
  useEffect(() => {
    const cleanup = onMount?.();
    if (typeof cleanup === "function") return cleanup;
  }, [onMount]);

  if (!PgTutorial.current) throw new Error("Current tutorial has not been set");

  const isStarted = PgTutorial.isStarted(PgTutorial.current.name);

  return (
    <Wrapper>
      {PgTutorial.page ? (
        <Main
          pageNumber={PgTutorial.page}
          pages={pages}
          layout={layout}
          isStarted={isStarted}
          onComplete={onComplete}
          start={start}
        />
      ) : (
        <About about={about} isStarted={isStarted} start={start} />
      )}
    </Wrapper>
  );
};

const Wrapper = styled.div`
  ${({ theme }) => css`
    ${PgTheme.getScrollbarCSS({ allChildren: true })};
    ${PgTheme.convertToCSS(theme.components.tutorial.default)};
  `}
`;
