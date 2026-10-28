import styled from "styled-components";

import Folders from "./Folders";
import NoWorkspace from "./NoWorkspace";
import Workspaces from "./Workspaces";
import { useExplorer } from "../../../../hooks";
import { useTutorialBeforeStart } from "@/entities/tutorial";

const Explorer = () => {
  const explorer = useExplorer({ checkInitialization: true });
  // A tutorial before its Start has no files yet, and "Create a new project"
  // would lead away from it; the column stays empty, as the stand draws it
  const tutorial = useTutorialBeforeStart();
  if (tutorial) return null;

  if (!explorer?.isTemporary) {
    if (!explorer?.allWorkspaceNames) return null;
    if (explorer.allWorkspaceNames.length === 0) return <NoWorkspace />;
  }

  return (
    <Wrapper>
      <Workspaces />
      <Folders />
    </Wrapper>
  );
};

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  user-select: none;
`;

export default Explorer;
