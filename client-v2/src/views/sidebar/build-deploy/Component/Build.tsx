import styled from "styled-components";

import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { Wrench } from "../../../../components/Icons";
import { useExplorer, useRenderOnChange } from "../../../../hooks";
import { PgCommand, PgGlobal } from "../../../../utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";

const Build = () => {
  const buildLoading = useRenderOnChange(PgGlobal.onDidChangeBuildLoading);

  const explorer = useExplorer();
  if (!explorer.isTemporary && !explorer.currentWorkspaceName) {
    return (
      <Callout>
        <CalloutDescription>No project to build.</CalloutDescription>
      </Callout>
    );
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
