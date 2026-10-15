import styled from "styled-components";

import { createLogger } from "@/shared/lib/logger";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import Button from "../../../../components/Button";
import Text from "../../../../components/Text";
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
  Info,
  Plus,
  Trash,
} from "../../../../components/Icons";
import { PgCommon, PgExplorer, PgTutorial, PgView } from "../../../../utils";
import { useExplorer } from "../../../../hooks";

const Workspaces = () => {
  if (PgExplorer.isTemporary) return <TemporaryWarning />;

  return (
    <Wrapper>
      <TopWrapper>
        <MainText>Projects</MainText>
        <WorkspaceButtons />
      </TopWrapper>
      <WorkspaceSelect />
    </Wrapper>
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
    <ButtonsWrapper>
      <Button onClick={handleCreate} kind="icon" title="Create">
        <Plus />
      </Button>

      <Button onClick={handleRename} kind="icon" title="Rename">
        <Edit />
      </Button>

      <Button
        onClick={handleDelete}
        kind="icon"
        hoverColor="error"
        title="Delete"
      >
        <Trash />
      </Button>

      <Button onClick={handleGithub} kind="icon" title="Import from Github">
        <Github />
      </Button>

      <Button
        onClick={handleFsImport}
        kind="icon"
        title="Import from local file system"
      >
        <ImportFile />
      </Button>

      <Button onClick={handleFsExport} kind="icon" title="Export">
        <ExportFile />
      </Button>
    </ButtonsWrapper>
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

const Wrapper = styled.div`
  margin: 1.5rem 0.5rem 0 0.5rem;
  padding: 0 0.5rem;
`;

const TopWrapper = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
`;

const MainText = styled.div`
  ${({ theme }) => `
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  `}
`;

const ButtonsWrapper = styled.div`
  margin-left: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0 0.5rem;
`;

const TemporaryWarning = () => {
  const handleImport = () => PgView.setModal(ImportTemporary);

  return (
    <TemporaryWarningWrapper>
      <Text icon={<Info color="info" />}>
        This is a temporary project, import it to persist changes.
      </Text>
      <Button onClick={handleImport} leftIcon={<ImportWorkspace />} fullWidth>
        Import
      </Button>
    </TemporaryWarningWrapper>
  );
};

const TemporaryWarningWrapper = styled.div`
  padding: 1rem 0.5rem;

  & > button {
    margin-top: 0.75rem;
  }
`;

export default Workspaces;
