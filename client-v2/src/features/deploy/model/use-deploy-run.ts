import { useSyncExternalStore } from "react";

import { PgDeployRun } from "@/commands/deploy/run";
import type { DeployRunState } from "@/commands/deploy/run";

const subscribe = (cb: () => void) => {
  const { dispose } = PgDeployRun.onDidChange(cb);
  return dispose;
};

/** The running deploy's step and progress, re-rendering as it moves */
export const useDeployRun = (): DeployRunState =>
  useSyncExternalStore(subscribe, () => PgDeployRun.state);
