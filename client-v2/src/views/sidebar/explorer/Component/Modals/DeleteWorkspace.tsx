import type { FC } from "react";
import styled, { css } from "styled-components";

import Modal from "../../../../../components/Modal";
import { Warning } from "../../../../../components/Icons";
import { PgExplorer } from "../../../../../utils";

interface DeleteWorkspaceProps {
  /** Which workspace to delete; defaults to the one the user is in */
  name?: string;
  /** Adds the line about losing lesson progress */
  isLesson?: boolean;
}

export const DeleteWorkspace: FC<
  React.PropsWithChildren<DeleteWorkspaceProps>
> = ({ name, isLesson }) => {
  const workspaceName = name ?? PgExplorer.currentWorkspaceName;

  return (
    <Modal
      title
      buttonProps={{
        text: "Delete",
        kind: "error",
        onSubmit: () => PgExplorer.deleteWorkspace(workspaceName),
      }}
    >
      <Content>
        <IconWrapper>
          <Warning color="warning" />
        </IconWrapper>
        <ContentText>
          <Main>
            Are you sure you want to delete workspace '{workspaceName}'?
          </Main>
          <Desc>This action is irreversable!</Desc>
          <Desc>- All files and folders will be deleted.</Desc>
          <Desc>- Program credentials will be deleted.</Desc>
          {/* Progress lives in `.workspace/tutorial-storage.json`, inside the
              directory about to be removed */}
          {isLesson && <Desc>- Your progress through the lesson is lost.</Desc>}
        </ContentText>
      </Content>
    </Modal>
  );
};

const Content = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
`;

const IconWrapper = styled.div`
  & > svg {
    width: 3rem;
    height: 3rem;
  }
`;

const ContentText = styled.div`
  display: flex;
  flex-direction: column;
  margin-left: 1rem;
`;

const Main = styled.span`
  font-weight: bold;
  word-break: break-all;
`;

const Desc = styled.span`
  ${({ theme }) => css`
    margin-top: 0.5rem;
    font-size: ${theme.font.code.size.small};
    color: ${theme.colors.default.textSecondary};
  `}
`;
