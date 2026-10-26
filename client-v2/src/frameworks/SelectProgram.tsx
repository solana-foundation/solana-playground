import { FC, useState } from "react";
import { InfoIcon } from "lucide-react";
import styled, { css } from "styled-components";

import { ModalFrame } from "@/widgets/overlays";
import { Callout, CalloutDescription } from "@/shared/ui/callout";

interface SelectProgramProps {
  /** Program names to select from */
  programNames: string[];
}

export const SelectProgram: FC<React.PropsWithChildren<SelectProgramProps>> = ({
  programNames,
}) => {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <ModalFrame
      name="select-program"
      title="Select the program to import"
      buttonProps={{
        text: "Select",
        onSubmit: () => selected,
      }}
    >
      <Content>
        <Callout variant="info">
          <InfoIcon />
          <CalloutDescription>
            Multiple programs have been found but playground currently supports
            one program per project.
          </CalloutDescription>
        </Callout>

        <ProgramsWrapper>
          {programNames.map((name) => (
            <Program
              key={name}
              isSelected={name === selected}
              onClick={() => setSelected((s) => (s === name ? null : name))}
            >
              {name}
            </Program>
          ))}
        </ProgramsWrapper>
      </Content>
    </ModalFrame>
  );
};

const Content = styled.div`
  max-width: 32rem;
`;

const ProgramsWrapper = styled.div`
  margin-top: 1rem;
`;

const Program = styled.div<{ isSelected: boolean }>`
  ${({ theme, isSelected }) => css`
    margin: 0.75rem 0;
    padding: 0.5rem 1rem;
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    color: ${theme.colors.default.textSecondary};
    font-weight: bold;
    transition: all ${theme.default.transition.duration.medium}
      ${theme.default.transition.type};

    &:hover {
      cursor: pointer;
      border-color: ${!isSelected && theme.colors.default.textPrimary};
      color: ${theme.colors.default.textPrimary};
    }

    ${isSelected &&
    `
      border-color: ${theme.colors.default.primary};
      color: ${theme.colors.default.textPrimary};
      `}
  `}
`;
