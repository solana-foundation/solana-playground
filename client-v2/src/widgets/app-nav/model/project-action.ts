/**
 * What a project's menu in the navigation can do. It lives in `model/`
 * because the slice's telemetry names it as well as its UI.
 */
export type ProjectAction =
  | "open"
  | "pin"
  | "unpin"
  | "rename"
  | "duplicate"
  | "export"
  | "share-gist"
  | "delete";
