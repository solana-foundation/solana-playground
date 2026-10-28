import { FC, useCallback, useEffect } from "react";

import { About, Main } from "./views";
import { PgTutorial } from "../../utils";
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

  // On component mount
  useEffect(() => {
    if (onMount) return onMount();
  }, [onMount]);

  if (!PgTutorial.current) throw new Error("Current tutorial has not been set");

  const isStarted = PgTutorial.isStarted(PgTutorial.current.name);

  return (
    <div className="pg-scrollbar-all flex-1 overflow-auto opacity-0 transition-opacity duration-150 ease-linear">
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
    </div>
  );
};
