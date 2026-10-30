import Folders from "./Folders";
import NoWorkspace from "./NoWorkspace";
import Workspaces from "./Workspaces";
import { useExplorer } from "../../../../hooks";
import { useTutorialBeforeStart } from "@/entities/tutorial";

const Explorer = () => {
  const explorer = useExplorer({ checkInitialization: true });
  // A tutorial before its Start has no files yet, and "Create a new project"
  // would lead away from it; the column stays empty, as the stand draws it
  const tutorial = useTutorialBeforeStart();
  if (tutorial) return null;

  if (!explorer?.isTemporary) {
    if (!explorer?.allWorkspaceNames) return null;
    if (explorer.allWorkspaceNames.length === 0) return <NoWorkspace />;
  }

  return (
    <div className="flex w-full flex-col select-none">
      <Workspaces />
      <Folders />
    </div>
  );
};

export default Explorer;
