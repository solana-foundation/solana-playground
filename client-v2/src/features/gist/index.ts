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
export { GistImportError, fetchGistFiles, importGist } from "./model/import";
export { gistTelemetry } from "./model/telemetry";
export type {
  GistCopiedLink,
  GistExportFailure,
  GistImportFailure,
  GistImportSource,
  GistShareSource,
  GistVisibility,
} from "./model/telemetry";
export { exportProjectWith } from "./model/export";
export type { ExportFailure, ExportResult } from "./model/export";
export { signInFailureMessage, useShareGist } from "./ui/ShareGist";
export type { ShareGistControl, ShareGistOptions } from "./ui/ShareGist";
export {
  default as BaseShareGist,
  shareAction,
  shareTitle,
} from "./ui/BaseShareGist";
export type {
  BaseShareGistProps,
  ShareAction,
  ShareFailure,
  ShareFiles,
  ShareStep,
  SignInEnding,
} from "./ui/BaseShareGist";
