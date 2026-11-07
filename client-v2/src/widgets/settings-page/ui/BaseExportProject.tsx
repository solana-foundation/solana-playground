import { ExportFile } from "@/components/Icons";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { cn } from "@/shared/lib/utils";
import { AsyncButton } from "@/shared/ui/async-button";

interface BaseOpenProjectLineProps {
  /** The open project, if any */
  name?: string;
  phone: boolean;
}

/**
 * The line above the Project section's buttons that names what Export
 * project takes, since the page shows no other sign of it (HOO-2691)
 */
export const BaseOpenProjectLine = ({
  name,
  phone,
}: BaseOpenProjectLineProps) => {
  const text = name
    ? `Exports ${name}, the project open now.`
    : "No project is open.";
  return (
    <p
      data-testid="settings-open-project"
      title={text}
      className={cn(
        "truncate text-xs text-muted-foreground",
        phone && "text-control font-read"
      )}
    >
      {text}
    </p>
  );
};

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
 * says "Export project" and "Every file as a zip".
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
