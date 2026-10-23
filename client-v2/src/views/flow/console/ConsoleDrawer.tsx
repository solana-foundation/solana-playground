import type { FC } from "react";
import { useEffect, useState } from "react";

import { createLogger } from "../../../shared/lib/logger";
import { PgTerminal } from "../../../utils";
import Terminal from "../../main/secondary/terminal/Component/Terminal";
import { PgBuildOutput } from "../../sidebar/assistant/bridge/build-output";
import { PgFlow } from "../state/stage";
import BaseConsoleDrawer from "./BaseConsoleDrawer";
import { describeConsoleStatus } from "./status";
import type { ConsoleStatus } from "./status";

const log = createLogger("flow:console");

interface ConsoleDrawerProps {
  open: boolean;
  onToggle: () => void;
}

/**
 * The console at the bottom of the centre column. The layout shell folds its
 * panel to the bar's height (`BOTTOM_BAR_PX`) rather than unmounting it, so
 * the xterm buffer (scrollback, running process) survives while it is
 * closed.
 */
const ConsoleDrawer: FC<ConsoleDrawerProps> = ({ open, onToggle }) => {
  const [status, setStatus] = useState<ConsoleStatus>(() =>
    describeConsoleStatus(PgFlow.state)
  );

  useEffect(() => {
    const b = PgFlow.onDidChange((flow) =>
      setStatus(describeConsoleStatus(flow))
    );
    // `PgBuildOutput` fills in slightly after the `build-finish` event that
    // sets `flow.build`, and it carries the diagnostic code a failed
    // status line needs -- recompute once it lands so a failed build never
    // gets stuck on the bare "build failed" fallback.
    const c = PgBuildOutput.onDidChange(() =>
      setStatus(describeConsoleStatus(PgFlow.state))
    );
    return () => {
      b.dispose();
      c.dispose();
    };
  }, []);

  // What `PgTerminal.process` needs to know whether a failure it printed
  // was seen
  useEffect(() => {
    PgTerminal.setConsoleOpen(open);
    return () => PgTerminal.setConsoleOpen(false);
  }, [open]);

  const clear = () => {
    PgTerminal.clear().catch((error: unknown) =>
      log.error(error, { report: true, context: { action: "clear" } })
    );
  };

  return (
    <BaseConsoleDrawer
      open={open}
      // The shell only flips; a request for the state it is in changes nothing
      onOpenChange={(next) => {
        if (next !== open) onToggle();
      }}
      status={status}
      onClear={clear}
    >
      <Terminal />
    </BaseConsoleDrawer>
  );
};

export default ConsoleDrawer;
