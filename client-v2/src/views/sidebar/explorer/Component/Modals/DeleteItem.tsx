import { FC } from "react";
import styled, { css } from "styled-components";

import { ModalFrame } from "@/widgets/overlays";
import { Warning } from "../../../../../components/Icons";
import { PgCommon, PgExplorer } from "../../../../../utils";

interface DeleteItemProps {
  path: string;
}

export const DeleteItem: FC<React.PropsWithChildren<DeleteItemProps>> = ({
  path,
}) => {
  const itemName = PgExplorer.getItemNameFromPath(path);

  const deleteItem = async () => {
    await PgExplorer.deleteItem(path);

    // Select element if there is no selected element
    if (!PgExplorer.getSelectedEl()) {
      const itemPathToSelect =
        PgExplorer.currentFilePath ??
        PgCommon.appendSlash(
          PgCommon.joinPaths(
            PgExplorer.getProjectRootPath(),
            PgExplorer.PATHS.SRC_DIRNAME
          )
        );
      const itemToSelect = PgExplorer.getElFromPath(itemPathToSelect);
      if (itemToSelect) PgExplorer.setSelectedEl(itemToSelect);
    }
  };

  return (
    <ModalFrame
      name="delete-item"
      title
      buttonProps={{
        text: "Delete",
        variant: "destructive",
        onSubmit: deleteItem,
      }}
    >
      <Content>
        <Icon>
          <Warning color="warning" />
        </Icon>
        <ContentText>
          <Main>Are you sure you want to delete '{itemName}'?</Main>
          <Desc>This action is irreversible.</Desc>
        </ContentText>
      </Content>
    </ModalFrame>
  );
};

const Content = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
`;

const Icon = styled.div`
  width: 2rem;
  height: 2rem;

  & > svg {
    width: 100%;
    height: 100%;
  }
`;

const ContentText = styled.div`
  display: flex;
  flex-direction: column;
  margin-left: 1rem;
`;

const Main = styled.span`
  font-weight: bold;
`;

const Desc = styled.span`
  ${({ theme }) => css`
    margin-top: 0.5rem;
    font-size: ${theme.font.code.size.small};
    color: ${theme.colors.default.textSecondary};
  `}
`;
