import { createTracker } from "@/shared/lib/telemetry";

import type { UnknownCommand } from "./unknown-command";

export type UnknownCommandEvents = {
  /** The terminal answered a command it does not know; `kind` says how: a suggestion, the shell-habit line or the plain line. Never the typed word. */
  unknown_command_answered: { kind: UnknownCommand["kind"] };
};

export const unknownCommandTelemetry = createTracker<UnknownCommandEvents>();
