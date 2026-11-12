import { createTracker } from "@/shared/lib/telemetry";

import type { LinkImportFailure, LinkSource } from "./link-import";

type NewProjectEvents = {
  /**
   * Start made a project from the framework's starter, from New project or
   * from Home; the event does not say which.
   */
  new_project_started: { framework: FrameworkName };
  /**
   * Start could not make the project; the reason shows under the name field
   * and was logged. A refused name is not counted: nothing was attempted.
   */
  new_project_start_failed: { framework: FrameworkName };
  /**
   * Import from GitHub opened a repository or a gist as a project, made now
   * or already there. A closed program picker is not counted.
   */
  new_project_imported: { via: LinkSource };
  /**
   * Import from GitHub stopped; the message shows under the field. `via`
   * is `unknown` for a link that is neither a repository nor a gist. A gist
   * import also sends `gist_import_failed` with `via: "new-project"`: that
   * one counts the gist import wherever it runs, this one the card.
   */
  new_project_import_failed: {
    via: LinkSource | "unknown";
    reason: LinkImportFailure;
  };
};

export const newProjectTelemetry = createTracker<NewProjectEvents>();
