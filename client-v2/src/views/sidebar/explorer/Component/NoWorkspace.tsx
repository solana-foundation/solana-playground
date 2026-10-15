import styled from "styled-components";

import Text from "../../../../components/Text";
import { CreateWorkspace } from "./Modals";
import { Plus } from "../../../../components/Icons";
import { PgView } from "../../../../utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";

const NoWorkspace = () => {
  const createWorkspace = () => PgView.setModal(CreateWorkspace);

  return (
    <Wrapper>
      <Text>Start by creating a new project.</Text>
      <AsyncButton
        variant="outline"
        onClick={createWorkspace}
        onError={reportButtonFailure}
        className="w-full"
      >
        <Plus data-icon="inline-start" />
        Create a new project
      </AsyncButton>
    </Wrapper>
  );
};

const Wrapper = styled.div`
  padding: 1.5rem 1rem;
  display: flex;
  justify-content: center;
  flex-direction: column;

  & > button {
    margin-top: 1rem;
  }
`;

export default NoWorkspace;
