import { InfoIcon } from "lucide-react";

import { createLogger } from "@/shared/lib/logger";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  CreateWorkspace,
  RenameWorkspace,
  DeleteWorkspace,
  ImportGithub,
  ImportFs,
  ImportTemporary,
  ExportWorkspace,
} from "./Modals";
import {
  Edit,
  ExportFile,
  Github,
  ImportFile,
  ImportWorkspace,
  Plus,
  Trash,
} from "../../../../components/Icons";
import { PgCommon, PgExplorer, PgTutorial, PgView } from "../../../../utils";
import { useExplorer } from "../../../../hooks";

const Workspaces = () => {
  if (PgExplorer.isTemporary) return <TemporaryWarning />;

  return (
    <div className="mx-2 mt-6 px-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[0.7rem] font-semibold tracking-[0.1em] text-[color:var(--text-secondary)] uppercase">
          Projects
        </div>
        <WorkspaceButtons />
      </div>
      <WorkspaceSelect />
    </div>
  );
};

const WorkspaceButtons = () => {
  const handleCreate = () => PgView.setModal(CreateWorkspace);
  const handleRename = () => PgView.setModal(RenameWorkspace);
  const handleDelete = () => PgView.setModal(DeleteWorkspace);
  const handleGithub = () => PgView.setModal(ImportGithub);
  const handleFsImport = () => PgView.setModal(ImportFs);
  const handleFsExport = () => PgView.setModal(ExportWorkspace);

  return (
    <div className="ml-2 flex items-center gap-x-2">
      <WorkspaceButton
        onClick={handleCreate}
        title="Create"
        failureAction="create a project"
      >
        <Plus />
      </WorkspaceButton>

      <WorkspaceButton
        onClick={handleRename}
        title="Rename"
        failureAction="rename the project"
      >
        <Edit />
      </WorkspaceButton>

      <WorkspaceButton
        onClick={handleDelete}
        title="Delete"
        failureAction="delete the project"
        className="hover:text-destructive"
      >
        <Trash />
      </WorkspaceButton>

      <WorkspaceButton
        onClick={handleGithub}
        title="Import from Github"
        failureAction="open the GitHub import"
      >
        <Github />
      </WorkspaceButton>

      <WorkspaceButton
        onClick={handleFsImport}
        title="Import from local file system"
        failureAction="open the file import"
      >
        <ImportFile />
      </WorkspaceButton>

      <WorkspaceButton
        onClick={handleFsExport}
        title="Export"
        failureAction="export the project"
      >
        <ExportFile />
      </WorkspaceButton>
    </div>
  );
};

/** An icon button whose click opens a modal and waits for it to close.
    While it waits the spinner takes the icon's place, and the title stays
    its accessible name. */
export const WorkspaceButton = (
  props: Omit<
    React.ComponentProps<typeof AsyncButton>,
    "onError" | "variant" | "size" | "loadingText"
  > & {
    title: string;
    /** What did not happen when the click fails, completing "Could not …" */
    failureAction: string;
  }
) => {
  const { failureAction, ...rest } = props;
  return (
    <AsyncButton
      variant="ghost"
      size="icon-sm"
      onError={reportButtonFailure(failureAction)}
      loadingText={<span className="sr-only">{props.title}</span>}
      {...rest}
    />
  );
};

const log = createLogger("explorer:workspaces");

export const WorkspaceSelect = () => {
  const explorer = useExplorer();

  const [tutorials, projects] = PgCommon.filterWithRemaining(
    explorer.allWorkspaceNames!,
    PgTutorial.isWorkspaceTutorial
  );

  const switchWorkspace = async (name: string) => {
    if (name === explorer.currentWorkspaceName) return;

    // Calling `PgExplorer.switchWorkspace` for both tutorial and
    // non-tutorial workspaces would be enough here, but we're manually
    // opening the tutorial when needed to avoid editor flickering i.e.
    // there is a small window just after the workspace switch, when the
    // editor has just enough time to open the new workspace, but the
    // `PgTutorial.open` has not yet run, which results in the user
    // briefly seeing the last opened file of the tutorial before the
    // loading screen kicks in.
    //
    // NOTE: If we ever add a loading transition for switching between
    // workspaces, or even a delay before opening new workspace files in
    // the editor, this check will no longer be necessary.
    if (PgTutorial.isWorkspaceTutorial(name)) await PgTutorial.open(name);
    else await PgExplorer.switchWorkspace(name);
  };

  return (
    <Select
      value={explorer.currentWorkspaceName ?? ""}
      onValueChange={(name) => {
        switchWorkspace(name).catch((e) =>
          log.error(e, { report: true, context: { workspace: name } })
        );
      }}
    >
      <SelectTrigger aria-label="Project" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectGroup>
          <SelectLabel>Projects</SelectLabel>
          {projects.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectGroup>
        {tutorials.length > 0 && (
          <SelectGroup>
            <SelectLabel>Tutorials</SelectLabel>
            {tutorials.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
};

const TemporaryWarning = () => {
  const handleImport = () => PgView.setModal(ImportTemporary);

  return (
    <div className="px-2 py-4 [&>button]:mt-3">
      <Callout variant="info">
        <InfoIcon />
        <CalloutDescription>
          This is a temporary project, import it to persist changes.
        </CalloutDescription>
      </Callout>
      <AsyncButton
        variant="outline"
        onClick={handleImport}
        onError={reportButtonFailure("import the project")}
        className="w-full"
      >
        <ImportWorkspace data-icon="inline-start" />
        Import
      </AsyncButton>
    </div>
  );
};

export default Workspaces;
