/**
 * The row sends no events of its own: its Run is `RunButton`, which reports
 * through `features/docs-link`'s tracker, and Add program and Test add none.
 * This module is the widget's own door to that tracker.
 */
export { docsLinkTelemetry } from "@/features/docs-link";
