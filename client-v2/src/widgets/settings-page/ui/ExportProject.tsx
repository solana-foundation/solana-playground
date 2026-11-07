import { useExplorer } from "@/hooks";
import { PgFramework } from "@/utils";

import BaseExportProject, { BaseOpenProjectLine } from "./BaseExportProject";

const exportProject = (name: string) => PgFramework.exportWorkspace({ name });

/** {@link BaseOpenProjectLine} for the open project */
export const OpenProjectLine = ({ phone }: { phone: boolean }) => (
  <BaseOpenProjectLine
    name={useExplorer().currentWorkspaceName}
    phone={phone}
  />
);

/** {@link BaseExportProject} for the open project */
const ExportProject = ({ className }: { className?: string }) => (
  <BaseExportProject
    name={useExplorer().currentWorkspaceName}
    onExport={exportProject}
    className={className}
  />
);

export default ExportProject;
