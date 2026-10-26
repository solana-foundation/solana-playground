import { PgRouter } from "../../utils";
import { openPageFromLink } from "../open-page-from-link";

export const programs = PgRouter.create({
  path: "/programs",
  // The list is a page now: open it, over the work or Home on `/`
  handle: () => openPageFromLink("programs"),
});
