import { FC } from "react";
import styled, { css } from "styled-components";

import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleHeading,
} from "@/shared/ui/collapsible";

interface InteractionProps {
  name: string;
  index: number;
}

const Interaction: FC<React.PropsWithChildren<InteractionProps>> = ({
  name,
  index,
  children,
}) => (
  <Wrapper index={index}>
    <Collapsible>
      <CollapsibleHeading>
        <CollapsibleChevron />
        {name}
      </CollapsibleHeading>
      <CollapsibleContent className="mt-2">{children}</CollapsibleContent>
    </Collapsible>
  </Wrapper>
);

const Wrapper = styled.div<Pick<InteractionProps, "index">>`
  ${({ theme, index }) => css`
    padding: 1rem;
    border-top: 1px solid ${theme.colors.default.border};
    background: ${index % 2 === 0 && theme.views.sidebar.right.default.otherBg};

    &:last-child {
      border-bottom: 1px solid ${theme.colors.default.border};
    }
  `}
`;

export default Interaction;
