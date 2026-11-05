// Public API of the slice: import from here, never from its internals.
// The terminal's answer to a command it does not know (Spec 13).
export { unknownCommandTelemetry } from "./model/telemetry";
export type { UnknownCommand } from "./model/unknown-command";
export { unknownCommandIn } from "./model/unknown-command";
