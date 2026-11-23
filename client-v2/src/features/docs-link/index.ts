// Public API of the slice: import from here, never from its internals.
// A docs page's "Open in Playground" link, and the stage row's Run for the
// client project it opens.
export {
  backToDocsHref,
  decodeDocsLink,
  DOCS_HOME,
  encodeDocsLink,
  MAX_DOCS_LINK_BYTES,
  MAX_LINK_SOL,
} from "./lib/link";
export type { DecodedDocsLink, DocsLink, DocsLinkFailure } from "./lib/link";
export type { LinkState } from "./model/opened";
export { PgDocsLink } from "./model/opened";
export { PgClientRun } from "./model/run";
export type { RunAnswer, RunState } from "./model/run";
export { docsLinkTelemetry } from "./model/telemetry";
export type { RunOutcome } from "./model/telemetry";
export { default as BaseBrokenLink } from "./ui/BaseBrokenLink";
export type { BaseBrokenLinkProps } from "./ui/BaseBrokenLink";
export { default as BaseRunButton } from "./ui/BaseRunButton";
export type { BaseRunButtonProps } from "./ui/BaseRunButton";
export { default as BaseRunCallout } from "./ui/BaseRunCallout";
export { default as BaseRunConfirm } from "./ui/BaseRunConfirm";
export type { BaseRunConfirmProps } from "./ui/BaseRunConfirm";
export type { BaseRunCalloutProps, RunSourceInfo } from "./ui/BaseRunCallout";
export { default as RunButton } from "./ui/RunButton";
export { default as RunCallout } from "./ui/RunCallout";
export { default as RunConfirm } from "./ui/RunConfirm";
