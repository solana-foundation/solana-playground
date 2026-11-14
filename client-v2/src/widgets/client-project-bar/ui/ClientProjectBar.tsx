import type { FC } from "react";

import { clusterName } from "@/entities/cluster";
import { RunButton } from "@/features/docs-link";
import { useRenderOnChange } from "@/hooks";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { PgCommand, PgCommon, PgConnection, PgExplorer } from "@/utils";

import { clientProjectTelemetry } from "../model/telemetry";
import BaseClientProjectBar from "./BaseClientProjectBar";

/** Scaffolds `src/lib.rs`, as the tree's add-program button did */
const handleAddProgram = async () => {
  await PgExplorer.createItem(
    PgCommon.joinPaths(PgExplorer.PATHS.SRC_DIRNAME, "lib.rs")
  );
  clientProjectTelemetry.track("client_project_program_added", {});
};

const handleAddProgramError = reportButtonFailure("add a program");
const handleTest = () => PgCommand.test.execute();
const handleTestError = reportButtonFailure("run the tests");

/** `BaseClientProjectBar` on the connection, the explorer and the commands */
const ClientProjectBar: FC = () => {
  // Unknown until the endpoint is read, and then the row names none
  const current = useRenderOnChange(PgConnection.onDidChangeCluster);
  return (
    <BaseClientProjectBar
      cluster={current ? clusterName(current) : undefined}
      onAddProgram={handleAddProgram}
      onAddProgramError={handleAddProgramError}
      onTest={handleTest}
      onTestError={handleTestError}
      run={<RunButton />}
    />
  );
};

export default ClientProjectBar;
