import { ComponentPropsWithoutRef, FC, ReactNode } from "react";
import styled, { css } from "styled-components";

import Tooltip from "../../../../components/Tooltip";
import { PgTheme } from "../../../../utils";

interface SidebarButtonProps extends ComponentPropsWithoutRef<"div"> {
  src: string;
  tooltip: ReactNode;
  active?: boolean;
}

const SidebarButton: FC<React.PropsWithChildren<SidebarButtonProps>> = ({
  src,
  tooltip,
  ...props
}) => (
  <Tooltip element={tooltip} placement="right" arrow={{ size: 4 }}>
    <IconWrapper {...props}>
      <Icon $src={src} aria-hidden />
    </IconWrapper>
  </Tooltip>
);

const IconWrapper = styled.div<Pick<SidebarButtonProps, "active">>`
  ${({ theme, active }) => css`
    ${PgTheme.convertToCSS(theme.views.sidebar.left.button.default)};
    color: ${active ? "var(--text-primary)" : "var(--text-secondary)"};

    ${active
      ? PgTheme.convertToCSS(theme.views.sidebar.left.button.selected)
      : "&:hover { color: var(--text-primary); }"}
  `}
`;

/**
 * The icon's shape as a mask over the text colour, so it follows the theme
 * from the tokens instead of being inverted by a filter. Serves the SVG
 * icons and the two alpha-shaped raster ones (GitHub, Settings) alike.
 */
const Icon = styled.span<{ $src: string }>`
  display: block;
  width: 2rem;
  height: 2rem;
  background-color: currentColor;
  -webkit-mask: url(${({ $src }) => $src}) center / 1.5rem no-repeat;
  mask: url(${({ $src }) => $src}) center / 1.5rem no-repeat;
`;

export default SidebarButton;
