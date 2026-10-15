import { FC } from "react";
import styled, { css } from "styled-components";

import Button from "./Default";
import { Copy } from "../Icons";
import { useCopy } from "../../hooks";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

interface CopyButtonProps {
  copyText: string;
}

const CopyButton: FC<React.PropsWithChildren<CopyButtonProps>> = ({
  copyText,
}) => {
  const [copied, setCopied] = useCopy(copyText);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <StyledButton onClick={setCopied} kind="icon" copied={copied}>
          <Copy />
        </StyledButton>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : "Copy"}</TooltipContent>
    </Tooltip>
  );
};

const StyledButton = styled(Button)<{ copied: boolean }>`
  ${({ theme, copied }) => css`
    ${copied && `color: ${theme.colors.state.success.color}`};

    &:hover {
      background: transparent;

      ${copied && `color: ${theme.colors.state.success.color}`};
    }
  `};
`;

export default CopyButton;
