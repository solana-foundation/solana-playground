import type { FC } from "react";
import { lazy, Suspense } from "react";

import Write from "./Write";
import { SpinnerWithBg } from "../../../components/Loading";
import type { Stage } from "../state/stage";
import { cn } from "@/shared/lib/utils";

const Build = lazy(() => import("./Build"));
const Deploy = lazy(() => import("./Deploy"));
const Interact = lazy(() => import("./Interact"));

interface StageRouterProps {
  stage: Stage;
}

/**
 * Swaps in the panel for the current dev-loop stage.
 *
 * `Write` (which hosts upstream's `Primary`) stays mounted at all times and
 * is only ever hidden with CSS. `Primary`'s content is handed to it once by
 * the router through a one-shot custom event -- unmounting it on every stage
 * change would leave it permanently blank the next time `Write` remounts.
 */
const StageRouter: FC<React.PropsWithChildren<StageRouterProps>> = ({
  stage,
}) => (
  <>
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col transition-[opacity] duration-150 ease-[ease] motion-reduce:transition-none",
        // The upstream tab strip (PgView.ids.TABS) butts its right-aligned
        // Wallet button against the column edge. Give it the same inset the
        // panel uses elsewhere. Failure mode: if upstream renames the id the
        // inset is simply lost, nothing breaks.
        "[&_#tabs]:pr-3",
        // `Primary` draws its own border and radius, a card on its own.
        // Inside Flow the frame is flush, with no card edges, so the stage
        // panel strips them.
        "[&>div]:rounded-none [&>div]:border-0",
        stage === "write" ? "opacity-100" : "hidden opacity-0"
      )}
      id="flow-stage-panel-write"
      role="tabpanel"
      aria-labelledby="flow-stage-tab-write"
    >
      <Write />
    </div>
    <Suspense fallback={<SpinnerWithBg loading size="2rem" />}>
      {/* Each branch's own `key` is redundant today -- only one of the
          three ever renders -- but keeps the remount-per-stage behavior
          intact if this ever collapses into a single ternary/lookup that
          would otherwise reuse one fade element across stage switches. */}
      {stage === "build" && (
        <div
          className={FADE}
          key="build"
          id="flow-stage-panel-build"
          role="tabpanel"
          aria-labelledby="flow-stage-tab-build"
        >
          <Build />
        </div>
      )}
      {stage === "deploy" && (
        <div
          className={FADE}
          key="deploy"
          id="flow-stage-panel-deploy"
          role="tabpanel"
          aria-labelledby="flow-stage-tab-deploy"
        >
          <Deploy />
        </div>
      )}
      {stage === "interact" && (
        <div
          className={FADE}
          key="interact"
          id="flow-stage-panel-interact"
          role="tabpanel"
          aria-labelledby="flow-stage-tab-interact"
        >
          <Interact />
        </div>
      )}
    </Suspense>
  </>
);

export default StageRouter;

/**
 * Plays a one-shot rise-and-fade when the surface it wraps mounts. Keyed by
 * stage in `StageRouter` so switching between Build / Deploy / Interact
 * remounts this wrapper and replays the animation. Never used around
 * `Write` -- see the note on `StageRouter`. `rise` is the keyframe of
 * playground-theme.css; the reduced-motion rule in index.css ends it at once.
 */
const FADE = "h-full animate-[rise_220ms_cubic-bezier(0.2,0,0,1)]";
