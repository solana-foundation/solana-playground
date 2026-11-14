import type { FC } from "react";

import { clusterName } from "@/entities/cluster";
import { RunButton } from "@/features/docs-link";
import { useRenderOnChange } from "@/hooks";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { PgCommand, PgCommon, PgConnection, PgExplorer } from "@/utils";

import BaseClientProjectBar from "./BaseClientProjectBar";

/** Scaffolds `src/lib.rs`, as the tree's add-program button did */
const addProgram = () =>
  PgExplorer.createItem(
    PgCommon.joinPaths(PgExplorer.PATHS.SRC_DIRNAME, "lib.rs")
  );

const onAddProgramError = reportButtonFailure("add a program");
const onTestError = reportButtonFailure("run the tests");

/** `BaseClientProjectBar` on the connection, the explorer and the commands */
const ClientProjectBar: FC = () => {
  // Unknown until the endpoint is read, and then the row names none
  const current = useRenderOnChange(PgConnection.onDidChangeCluster);
  return (
    <BaseClientProjectBar
      cluster={current ? clusterName(current) : undefined}
      onAddProgram={addProgram}
      onAddProgramError={onAddProgramError}
      onTest={() => PgCommand.test.execute()}
      onTestError={onTestError}
      run={<RunButton />}
    />
  );
};

export default ClientProjectBar;
