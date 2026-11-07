import type { LimitKind } from "../../entities/project";
import { createTracker } from "../../shared/lib/telemetry";

/** Which explorer write a limit refused */
export type LimitActionParam = "create" | "rename" | "import";

// The explorer is a legacy root with no slice; its tracker sits beside it and
// moves with it, keeping its event names, when it becomes one.
type ExplorerEvents = {
  /**
   * A create, rename or import was refused because the project it would
   * leave is over a limit; nothing was written. `limit` is the one the
   * refusal's message names.
   */
  explorer_limit_refused: { action: LimitActionParam; limit: LimitKind };
};

export const explorerTelemetry = createTracker<ExplorerEvents>();
