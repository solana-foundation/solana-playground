// Public API of the slice: import from here, never from its internals.
// Counting projects that are imported, viewed from a GitHub link and
// exported (HOO-2751, funnel-events tasks 2.1 to 2.4).
export {
  trackExportAsIs,
  trackExported,
  trackExportFailed,
} from "./model/export";
export type { Exported } from "./model/export";
export { trackImport, trackImportFailure } from "./model/import";
export { importReasonOf } from "./model/reason";
export { trackView } from "./model/view";
export { projectFilesTelemetry } from "./model/telemetry";
export type {
  ExportProfile,
  ExportVia,
  ImportReason,
  ImportVia,
} from "./model/telemetry";
