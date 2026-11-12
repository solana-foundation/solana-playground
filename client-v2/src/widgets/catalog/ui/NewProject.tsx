import { ImportFromUrl, StartFromScratch } from "@/features/new-project";

import type { NewProjectState } from "../model/use-new-project";
import BaseNewProject from "./BaseNewProject";

/**
 * New project, connected: Start from scratch and the catalog's two lists
 * from `useNewProject`, which the page holds (`NewProjectPage`).
 */
const NewProject = ({ project }: { project: NewProjectState }) => (
  <BaseNewProject
    {...project.view}
    scratch={
      <>
        <StartFromScratch
          held={project.busy}
          onRunning={project.onStarting}
          onStarted={project.closePage}
          onFailed={project.onStartFailed}
        />
        <ImportFromUrl />
      </>
    }
  />
);

export default NewProject;
