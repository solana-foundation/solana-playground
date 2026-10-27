import { createTracker } from "@/shared/lib/telemetry";

type NewProjectEvents = {
  /**
   * Start made a project from the framework's starter, from New project or
   * from Home; the event does not say which.
   */
  new_project_started: { framework: string };
  /**
   * Start could not make the project; the reason shows under the name field
   * and was logged. A refused name is not counted: nothing was attempted.
   */
  new_project_start_failed: { framework: string };
};

export const newProjectTelemetry = createTracker<NewProjectEvents>();
