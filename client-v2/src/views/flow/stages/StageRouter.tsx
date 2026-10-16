import type { FC } from "react";
import { lazy, Suspense } from "react";
import styled from "styled-components";

import Write from "./Write";
import { SpinnerWithBg } from "../../../components/Loading";
import type { Stage } from "../state/stage";

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
    <WriteSlot
      $hidden={stage !== "write"}
      id="flow-stage-panel-write"
      role="tabpanel"
      aria-labelledby="flow-stage-tab-write"
    >
      <Write />
    </WriteSlot>
    <Suspense fallback={<SpinnerWithBg loading size="2rem" />}>
      {/* Each branch's own `key` is redundant today -- only one of the
          three ever renders -- but keeps the remount-per-stage behavior
          intact if this ever collapses into a single ternary/lookup that
          would otherwise reuse one `Fade` element across stage switches. */}
      {stage === "build" && (
        <Fade
          key="build"
          id="flow-stage-panel-build"
          role="tabpanel"
          aria-labelledby="flow-stage-tab-build"
        >
          <Build />
        </Fade>
      )}
      {stage === "deploy" && (
        <Fade
          key="deploy"
          id="flow-stage-panel-deploy"
          role="tabpanel"
          aria-labelledby="flow-stage-tab-deploy"
        >
          <Deploy />
        </Fade>
      )}
      {stage === "interact" && (
        <Fade
          key="interact"
          id="flow-stage-panel-interact"
          role="tabpanel"
          aria-labelledby="flow-stage-tab-interact"
        >
          <Interact />
        </Fade>
      )}
    </Suspense>
  </>
);

export default StageRouter;

const WriteSlot = styled.div<{ $hidden: boolean }>`
  display: ${({ $hidden }) => ($hidden ? "none" : "flex")};
  flex-direction: column;
  flex: 1;
  min-height: 0;
  opacity: ${({ $hidden }) => ($hidden ? 0 : 1)};
  transition: opacity 150ms ease;

  /* The upstream tab strip (PgView.ids.TABS) butts its right-aligned
     Wallet button against the panel edge, which sits under the floating
     panel's rounded corner. Give it the same inset the panel uses
     elsewhere. Failure mode: if upstream renames the id the inset is
     simply lost, nothing breaks. */
  & #tabs {
    padding-right: 0.75rem;
  }

  /* Primary's own wrapper carries a border and a 14px radius from
     theme.views.main.primary.default, which make it a floating panel on its
     own. Inside Flow it sits within Center, which already
     draws that chrome -- so it reads as a second rounded border nested
     inside the first. */
  & > div {
    border: none;
    border-radius: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

/**
 * Plays a one-shot rise-and-fade when the surface it wraps mounts. Keyed by
 * stage in `StageRouter` so switching between Build / Deploy / Interact
 * remounts this wrapper and replays the animation. Never used around
 * `Write` -- see the note above `WriteSlot`.
 */
const Fade = styled.div`
  animation: rise 220ms cubic-bezier(0.2, 0, 0, 1);
  height: 100%;

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;
