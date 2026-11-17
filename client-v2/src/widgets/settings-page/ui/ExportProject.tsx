import { exportAsIs } from "@/features/project-export";
import { trackExportAsIs } from "@/features/project-files";
import { useExplorer } from "@/hooks";

import BaseExportProject, { exportRowCopyOf } from "./BaseExportProject";

/**
 * The project as it is, counted as started from Settings (spec
 * `client-v2-project-files`, "The settings page's export is counted")
 */
const exportProject = (name: string) =>
  trackExportAsIs(() => exportAsIs(name), "settings");

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
