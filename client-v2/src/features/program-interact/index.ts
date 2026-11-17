// Public API of the slice: import from here, never from its internals.
// An instruction call's events, sent by `runCall` (`views/flow/stages`).
export { interactTelemetry } from "./model/telemetry";
export type { InteractCluster, InteractFailedPhase } from "./model/telemetry";
