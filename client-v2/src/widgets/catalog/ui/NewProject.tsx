import { StartFromScratch } from "@/features/new-project";
import type { NewProjectState } from "../model/use-new-project";
import BaseNewProject from "./BaseNewProject";

/**
 * New project, connected: Start from scratch and the catalog's two lists
 * from `useNewProject`, which the dialog holds above its `ModalFrame`.
 */
const NewProject = ({ project }: { project: NewProjectState }) => (
  <BaseNewProject
    {...project.view}
    scratch={
      <StartFromScratch
        held={project.busy}
        onRunning={project.onStarting}
        onStarted={project.closeDialog}
      />
    }
  />
);

export default NewProject;
