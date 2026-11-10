import { catalogPage } from "../model/catalog-page";
import { useNewProject } from "../model/use-new-project";
import NewProject from "./NewProject";

/**
 * "What do you want to build?" as a page of its own, beside Tutorials and
 * Programs. What starts or opens a project from it closes the page.
 */
const NewProjectPage = () => (
  <NewProject
    project={useNewProject(() => catalogPage.closePage("new-project"))}
  />
);

export default NewProjectPage;
