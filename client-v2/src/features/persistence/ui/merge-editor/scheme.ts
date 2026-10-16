/**
 * The scheme of the resolve view's models -- see `uriOf` in `controller.ts`.
 *
 * In a module of its own, with no imports, so the main editor can tell the
 * view's models apart without loading the view.
 */
export const MERGE_SCHEME = "pg-merge";

/** Whether a Monaco model belongs to the resolve view, by its address */
export const isMergeModel = (uri: { scheme: string }) =>
  uri.scheme === MERGE_SCHEME;
