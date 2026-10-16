import { lazy, Suspense, useState } from "react";
import type { FC } from "react";

import LessonSurface from "./LessonSurface";
import { SpinnerWithBg } from "../../../components/Loading";
import { PgTutorial } from "../../../utils";
import { useRenderOnChange } from "../../../hooks";
import type { TutorialData } from "../../../utils";

interface LessonRouteProps {
  tutorial: TutorialData;
}

/**
 * Decides between upstream's `Tutorial` (About/Start, then its own editor
 * plus markdown pane) and Flow's `LessonSurface` (editor alone) for a
 * tutorial the fork has given a lesson path.
 *
 * Whether a lesson path exists is fixed for the life of a route -- the
 * route itself checks that once, before ever rendering this component.
 * Whether the tutorial is *started* is not: `PgTutorial.start()` lives
 * inside upstream's `Tutorial` and runs well after this component has
 * mounted, so that half of the decision has to live somewhere that
 * re-renders on it. `useRenderOnChange(PgTutorial.onDidChange)` is the
 * same subscription upstream's own `Tutorial` uses to notice its own
 * `start()` call; `start()` only updates tutorial state once
 * `PgExplorer.createWorkspace()` has resolved, so `PgTutorial.isStarted`
 * already reflects the new workspace by the time this fires.
 */
const LessonRoute: FC<React.PropsWithChildren<LessonRouteProps>> = ({
  tutorial,
}) => {
  useRenderOnChange(PgTutorial.onDidChange);

  // Loaded lazily and only once per mount -- this component lives for the
  // whole routed session (page changes, Start, etc. do not remount it) so
  // there is exactly one tutorial whose component this could ever be.
  const [UpstreamTutorial] = useState(() =>
    lazy(() => tutorial.importComponent())
  );

  if (PgTutorial.isStarted(tutorial.name)) return <LessonSurface />;

  return (
    <Suspense fallback={<SpinnerWithBg loading size="2rem" />}>
      <UpstreamTutorial {...tutorial} />
    </Suspense>
  );
};

export default LessonRoute;
