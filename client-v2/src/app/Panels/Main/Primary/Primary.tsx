import { useCallback, useEffect, useState } from "react";
import styled, { css, keyframes } from "styled-components";

import { createLogger } from "@/shared/lib/logger";

import ErrorBoundary, {
  type ErrorBoundaryChildren,
} from "../../../../components/ErrorBoundary";
import { SpinnerWithBg } from "../../../../components/Loading";
import { useGetAndSetStatic } from "../../../../hooks";
import { PgCommon, PgTheme, PgView } from "../../../../utils";

const log = createLogger("view:main-primary");

const Primary = () => {
  const [el, setEl] = useState<ErrorBoundaryChildren>(null);
  const setElWithTransition = useCallback(async (nextEl: unknown) => {
    if (PgCommon.isAsyncFunction(nextEl)) {
      setEl(null);

      const setContent = async () => {
        setEl(
          PgCommon.callIfNeeded(
            await (nextEl as () => unknown)()
          ) as ErrorBoundaryChildren
        );
      };

      try {
        await PgCommon.transition(setContent);
      } catch (e) {
        // Shown in place of the view, but never thrown, so React and the
        // boundary do not see it: say it here. A view put back on a remount
        // (`PgView.announceMainPrimaryUnmount`) runs its route's loader again.
        log.error(e, { report: true });
        setEl({ error: e as Error, refresh: setContent });
      }
    } else {
      setEl(PgCommon.callIfNeeded(nextEl) as ErrorBoundaryChildren);
    }
  }, []);

  useGetAndSetStatic(
    PgView.events.MAIN_PRIMARY_STATIC,
    el,
    setElWithTransition
  );

  // Declared after `useGetAndSetStatic`, so its listeners are in place when
  // the `setMainPrimary` calls this releases send `set`. The unmount lets
  // the next `Primary` to mount get this one's content back: the work
  // unmounts once no project is open, and its route does not run again.
  useEffect(() => {
    PgView.announceMainPrimaryMount();
    return () => PgView.announceMainPrimaryUnmount();
  }, []);

  return (
    <Wrapper>
      <StyledSpinnerWithBg loading={!el} size="2rem">
        <ErrorBoundary>{el}</ErrorBoundary>
      </StyledSpinnerWithBg>
    </Wrapper>
  );
};

const Wrapper = styled.div`
  ${({ theme }) => css`
    ${PgTheme.getScrollbarCSS({ allChildren: true })};
    ${PgTheme.convertToCSS(theme.views.main.primary.default)};
  `}
`;

const StyledSpinnerWithBg = styled(SpinnerWithBg)`
  ${({ theme }) => css`
    display: flex;

    & > *:last-child {
      flex: 1;
      overflow: auto;
      opacity: 0;
      animation: ${fadeInAnimation} ${theme.default.transition.duration.long}
        ${theme.default.transition.type} forwards;
    }
  `}
`;

const fadeInAnimation = keyframes`
  0% { opacity: 0 }
  40% { opacity : 0 }
  100% { opacity: 1 }
`;

export default Primary;
