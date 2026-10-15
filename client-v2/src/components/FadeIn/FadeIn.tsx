import styled, { css, DefaultTheme, keyframes } from "styled-components";

interface FadeInProps {
  duration?: keyof DefaultTheme["default"]["transition"]["duration"];
}

// `backwards`, not `forwards`: the end state is the element's own opacity,
// and an animation that keeps filling after it ends keeps the stacking
// context it made. `AppLazy` wraps the whole page in one, which puts
// everything inside it, Flow's `PortalAbove` among it, at level 0 under
// anything on `body` with a z-index (the layout shell's Sheets). Menus and
// dialogs portal to `body` through Radix, so they no longer sink, but a fill
// that stayed would still trap whatever else renders inside the page.
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
