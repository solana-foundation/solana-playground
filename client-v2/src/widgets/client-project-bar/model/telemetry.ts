import { createTracker, type NoParams } from "@/shared/lib/telemetry";

type ClientProjectEvents = {
  /** Add program in a client project's row created `src/lib.rs`. */
  client_project_program_added: NoParams;
};

export const clientProjectTelemetry = createTracker<ClientProjectEvents>();
