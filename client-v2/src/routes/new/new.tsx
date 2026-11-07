import { PgRouter } from "../../utils";
import { openPageFromLink } from "../open-page-from-link";

export const newProject = PgRouter.create({
  path: "/new",
  // New project is a page: open it, over the work or Home on `/`
  handle: () => openPageFromLink("new-project"),
});
