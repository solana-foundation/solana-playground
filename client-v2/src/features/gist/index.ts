// Public API of the slice: import from here, never from its internals.
// Shared by the export (HOO-1760) and the import (HOO-1761) of a gist.
export {
  fromGistFiles,
  GistFormatError,
  isExportablePath,
  MANIFEST_NAME,
  MAX_GIST_BYTES,
  MAX_GIST_FILES,
  measureGist,
  toGistFiles,
} from "./lib/format";
export type { GistFiles, GistFormatReason } from "./lib/format";
export { isGistUrl, parseGistRef, parseGistUrl } from "./lib/url";
export type { GistRef } from "./lib/url";
export { GistImportError, getGistFiles, importGist } from "./model/import";
export { gistTelemetry } from "./model/telemetry";
export type {
  GistExportFailure,
  GistImportFailure,
  GistImportSource,
} from "./model/telemetry";
export { exportProject } from "./model/export";
export type { ExportFailure, ExportResult } from "./model/export";
export { default as ShareGist } from "./ui/ShareGist";
export type { ShareGistProps } from "./ui/ShareGist";
export { default as BaseShareGist } from "./ui/BaseShareGist";
export type {
  BaseShareGistProps,
  ShareFailure,
  ShareStep,
} from "./ui/BaseShareGist";
