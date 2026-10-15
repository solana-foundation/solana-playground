import styled from "styled-components";

import ImportButton from "../../../../../components/ImportButton";
import {
  PgCommon,
  PgExplorer,
  PgProgramInfo,
  PgServer,
} from "../../../../../utils";
import { useRenderOnChange } from "../../../../../hooks";
import { AsyncButton } from "@/shared/ui/async-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";

const ProgramBinary = () => (
  <Wrapper>
    <Import />
    <Export />
  </Wrapper>
);

const Wrapper = styled.div`
  display: flex;
  gap: 1rem;
`;

const Import = () => (
  <ImportButton
    accept=".so"
    onImport={async (ev) => {
      const files = ev.target.files;
      if (!files?.length) {
        PgProgramInfo.update({ importedProgram: null });
        return;
      }

      // A file that cannot be read throws; ImportButton reports it
      const file = files[0];
      const bytes = new Uint8Array(await file.arrayBuffer());
      PgProgramInfo.update({ importedProgram: { bytes, fileName: file.name } });
    }}
    showImportText
  >
    Import
  </ImportButton>
);

const Export = () => {
  const uuid = useRenderOnChange(PgProgramInfo.onDidChangeUuid);
  if (!uuid) return null;

  return (
    <AsyncButton
      variant="outline"
      onClick={async () => {
        const programBuffer = await PgServer.deploy(uuid);
        const programName = PgExplorer.currentWorkspaceName ?? "program";
        PgCommon.export(`${programName}.so`, programBuffer);
      }}
      onError={reportButtonFailure}
    >
      Export
    </AsyncButton>
  );
};

export default ProgramBinary;
