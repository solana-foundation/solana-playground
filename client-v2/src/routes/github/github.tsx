import { GITHUB_ROUTE, PgGithub, PgRouter } from "../../utils";
import { handleRoute } from "../common";

/**
 * A GitHub repository, or a folder of one, open in the playground at
 * `/github/<owner>/<repo>[/tree/<ref>/<folder>]`: GitHub's own path after
 * `/github/`, one catch-all segment, so a file-based router serves it as is.
 */
export const github = PgRouter.create({
  path: `${GITHUB_ROUTE}/{path}`,
  validate: ({ path }) => PgGithub.isValidUrl(`github.com/${path}`),
  handle: ({ path }) => {
    return handleRoute({
      getExplorerInitArg: async () => ({
        files: await PgGithub.getFiles(`github.com/${path}`),
      }),
    });
  },
});
