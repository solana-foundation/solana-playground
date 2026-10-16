import { useCallback, useState } from "react";
import styled, { css, keyframes } from "styled-components";

import ErrorBoundary, {
  type ErrorBoundaryChildren,
} from "../../../../components/ErrorBoundary";
import { SpinnerWithBg } from "../../../../components/Loading";
import { PgCommon, PgTheme, PgView } from "../../../../utils";
import { useGetAndSetStatic } from "../../../../hooks";

const Primary = () => {
  const [el, setEl] = useState<ErrorBoundaryChildren>(null);
  const setElWithTransition = useCallback(async (el: unknown) => {
    if (PgCommon.isAsyncFunction(el)) {
      setEl(null);

      const setContent = async () => {
        setEl(
          PgCommon.callIfNeeded(
            await (el as () => unknown)()
          ) as ErrorBoundaryChildren
        );
      };

      try {
        await PgCommon.transition(setContent);
      } catch (e) {
        setEl({ error: e as Error, refresh: setContent });
      }
    } else {
      setEl(PgCommon.callIfNeeded(el) as ErrorBoundaryChildren);
    }
  }, []);

  useGetAndSetStatic(
    PgView.events.MAIN_PRIMARY_STATIC,
    el,
    setElWithTransition
  );

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
