import styled from "styled-components";

import Text from "../../../../components/Text";
import { Wrench } from "../../../../components/Icons";
import { useExplorer, useRenderOnChange } from "../../../../hooks";
import { PgCommand, PgGlobal } from "../../../../utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";

const Build = () => {
  const buildLoading = useRenderOnChange(PgGlobal.onDidChangeBuildLoading);

  const explorer = useExplorer();
  if (!explorer.isTemporary && !explorer.currentWorkspaceName) {
    return <Text>No project to build.</Text>;
  }

  return (
    <Wrapper>
      <AsyncButton
        variant="secondary"
        onClick={() => PgCommand.build.execute()}
        loading={buildLoading}
        onError={reportButtonFailure}
        className="w-full"
      >
        <Wrench data-icon="inline-start" />
        {buildLoading ? "Building..." : "Build"}
      </AsyncButton>
    </Wrapper>
  );
};

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
`;

export default Build;
