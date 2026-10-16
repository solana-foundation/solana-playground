import { PgRouter, PgShare } from "../../utils";
import { handleRoute } from "../common";

export const share = PgRouter.create({
  path: "/{shareId}",
  // Never match: sharing is disabled in this fork, so `/{shareId}` falls
  // through to the not-found route instead of fetching from the share server.
  validate: () => false,
  // validate: ({ shareId }) => PgShare.isValidId(shareId),
  handle: ({ shareId }) => {
    return handleRoute({
      getExplorerInitArg: async () => ({ files: await PgShare.get(shareId) }),
    });
  },
});
