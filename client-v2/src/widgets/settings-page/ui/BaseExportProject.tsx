import { ExportFile } from "@/components/Icons";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";

/** The Export current project row's name and help line */
export interface ExportRowCopy {
  name: string;
  description: string;
}

/**
 * The row's help line names the project Export takes, since the page shows
 * no other sign of it (HOO-2691); without one, it says why Export is disabled.
 */
export const exportRowCopyOf = (
  project: string | undefined
): ExportRowCopy => ({
  name: "Export current project",
  description: project
    ? `All files of "${project}" as a zip.`
    : "No project is open.",
});

interface BaseExportProjectProps {
  /** The project to export; the button is disabled without one */
  name?: string;
  /** Download `name` as a zip */
  onExport: (name: string) => Promise<unknown>;
  className?: string;
}

/**
 * Settings › Export project: downloads the project as is. Its zip is what
 * Import › From files takes back. It reads "Export" because its row already
 * says "Export current project" and names the project its zip holds.
 */
const BaseExportProject = ({
  name,
  onExport,
  className,
}: BaseExportProjectProps) => (
  <AsyncButton
    variant="outline"
    className={className}
    aria-label="Export project"
    disabled={!name}
    // The project the line names, not whatever is open when the click lands
    onClick={() => (name ? onExport(name) : undefined)}
    onError={reportButtonFailure("export the project")}
  >
    <ExportFile data-icon="inline-start" />
    Export
  </AsyncButton>
);

export default BaseExportProject;
