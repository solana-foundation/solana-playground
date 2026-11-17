// Public API of the slice: import from here, never from its internals.
// What the `run` and `test` commands report (HOO-2751). The commands live in
// the legacy `commands/run-and-test` and send through this tracker without a
// scope.
export { runTelemetry } from "./model/telemetry";
export type { RunErrorReason, RunKind, RunOutcome } from "./model/telemetry";
