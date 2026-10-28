import InteractBody from "../../../flow/stages/InteractBody";
import { PgConnection, PgProgramInfo } from "../../../../utils";
import type { Idl } from "../../../../utils/program-interaction";
import { useProgramInfo, useRenderOnChange } from "../../../../hooks";

/**
 * The sidebar's Test page: the Interact stage's body for the project's own
 * program, so both places call the same way.
 */
const Test = ({ idl }: { idl: Idl }) => {
  useProgramInfo();
  useRenderOnChange(PgConnection.onDidChangeCluster);
  return (
    <InteractBody
      idl={idl}
      programId={PgProgramInfo.getPkStr()}
      cluster={PgConnection.cluster}
    />
  );
};

export default Test;
