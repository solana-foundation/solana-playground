import { useExplorer } from "@/hooks";
import { PgFramework } from "@/utils";

import BaseExportProject, { exportRowCopyOf } from "./BaseExportProject";

const exportProject = (name: string) => PgFramework.exportWorkspace({ name });

/** {@link exportRowCopyOf} for the open project */
export const useExportRowCopy = () =>
  exportRowCopyOf(useExplorer().currentWorkspaceName);

/** {@link BaseExportProject} for the open project */
const ExportProject = ({ className }: { className?: string }) => (
  <BaseExportProject
    name={useExplorer().currentWorkspaceName}
    onExport={exportProject}
    className={className}
  />
);

export default ExportProject;
