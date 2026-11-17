// Public API of the slice: import from here, never from its internals.
// The build's events, sent by the `build` command (`commands/build`) that the
// Build stage, the terminal, the assistant and a tutorial all run.
export { buildTelemetry } from "./model/telemetry";
export type { BuildFailedReason, BuildFramework } from "./model/telemetry";
