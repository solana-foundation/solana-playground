import { getGistFiles, parseGistRef, parseGistUrl } from "@/features/gist";
import type { GistRef } from "@/features/gist";
import { PgRouter } from "../../utils";
import { handleRoute } from "../common";

/**
 * Open a gist's files as a view that is not saved, as `/{githubUrl}` opens a
 * repository's.
 *
 * @param ref the gist
 * @returns the route's handle
 */
const openGist = (ref: GistRef) =>
  handleRoute({
    getExplorerInitArg: async () => ({
      files: (await getGistFiles(ref, "link")).files,
    }),
  });

/** A gist the route's `validate` already accepted; a miss here is a bug */
const accepted = (ref: GistRef | undefined) => {
  if (!ref) throw new Error("The route's validate let a non-gist through.");
  return ref;
};

/** `/gist/<id>` and `/gist/<id>/<revision>`: the short link to share */
export const gist = PgRouter.create({
  path: "/gist/{ref}",
  validate: ({ ref }) => parseGistRef(ref) !== undefined,
  handle: ({ ref }) => openGist(accepted(parseGistRef(ref))),
});

/** The playground URL followed by a gist URL */
export const gistDefault = PgRouter.create({
  path: "/{gistUrl}",
  validate: ({ gistUrl }) => parseGistUrl(gistUrl) !== undefined,
  handle: ({ gistUrl }) => openGist(accepted(parseGistUrl(gistUrl))),
});
