import styled, { css, DefaultTheme, keyframes } from "styled-components";

interface FadeInProps {
  duration?: keyof DefaultTheme["default"]["transition"]["duration"];
}

// `backwards`, not `forwards`: the end state is the element's own opacity,
// and an animation that keeps filling after it ends keeps the stacking
// context it made. `AppLazy` wraps the whole page in one, so the page's
// portals, Flow's `PortalAbove` included, sat at level 0 under anything on
// `body` with a z-index (the layout shell's Sheets), and a menu opened from
// the project Sheet sank behind it once its own fade ended.
const FadeIn = styled.div<FadeInProps>`
  ${({ theme, duration = "short" }) => css`
    animation: ${fadeIn} ${theme.default.transition.duration[duration]}
      ${theme.default.transition.type} backwards;
  `}
`;

const fadeIn = keyframes`
  0% { opacity: 0 }
  100% { opacity: 1 }
`;

export default FadeIn;
