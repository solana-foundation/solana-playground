import type { FC } from "react";
import { useEffect, useReducer, useState } from "react";

import { useSetStatic } from "../../../hooks/useSetStatic";
import { useViewport } from "../../../shared/lib/hooks/use-viewport";
import { createLogger } from "../../../shared/lib/logger";
import {
  PgCommandManager,
  PgCommon,
  PgExplorer,
  PgTerminal,
  PgView,
} from "../../../utils";
import { CONSOLE_KEY, keyLabel } from "../../../widgets/layout-shell";
import Terminal from "../../main/secondary/terminal/Component/Terminal";
import { PgBuildOutput } from "../../sidebar/assistant/bridge/build-output";
import { PgFlow } from "../state/stage";
import BaseConsoleDrawer from "./BaseConsoleDrawer";
import type { ConsoleStatus } from "./status";
import {
  describeConsoleStatus,
  runToStop,
  withoutClientRunHint,
} from "./status";

const log = createLogger("flow:console");

interface ConsoleDrawerProps {
  open: boolean;
  onToggle: () => void;
  /**
   * A tutorial's own bar (`widgets/tutorial-workspace`): its status line in
   * place of the dev loop's, no label, and a line before anything ran
   */
  tutorial?: { status: ConsoleStatus; empty: string | null };
}

/**
 * How long the run in flight has taken, ticking once a second, or `null`
 * while nothing runs. A build counts from its own `startedAt`, as the Build
 * stage's slow line does, so the two agree after a remount; a deploy carries
 * no start time, so it counts from when the strip first saw it run.
 */
const useElapsed = (isRunning: boolean, startedAt: number | null) => {
  const [seen, setSeen] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) {
      setSeen(null);
      return;
    }
    const start = Date.now();
    setSeen(start);
    setNow(start);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isRunning, startedAt]);
  const since = startedAt ?? seen;
  return !isRunning || since === null ? null : Math.max(0, now - since);
};

/**
 * The console at the bottom of the centre column. The layout shell folds its
 * panel to the bar's height (`BOTTOM_BAR_PX`) rather than unmounting it, so
 * the xterm buffer (scrollback, running process) survives while it is
 * closed.
 */
const ConsoleDrawer: FC<ConsoleDrawerProps> = ({
  open,
  onToggle,
  tutorial,
}) => {
  const viewport = useViewport();
  const [flow, setFlow] = useState(() => PgFlow.state);
  // `PgBuildOutput` fills in slightly after the `build-finish` event that
  // sets `flow.build`, and it carries the diagnostic code a failed status
  // line needs -- redraw once it lands so a failed build never gets stuck on
  // the bare "Build failed" fallback.
  const [, outputLanded] = useReducer((n: number) => n + 1, 0);

  const [hasClientRun, setHasClientRun] = useState(false);
  useEffect(() => {
    const subs = [
      PgCommandManager.onDidStart("run", () => setHasClientRun(true)),
      // The drawer outlives the project: a run in one says nothing of the next
      PgExplorer.onDidSwitchWorkspace(() => setHasClientRun(false)),
    ];
    return () => subs.forEach((sub) => sub.dispose());
  }, []);

  useEffect(() => {
    const b = PgFlow.onDidChange(setFlow);
    const c = PgBuildOutput.onDidChange(outputLanded);
    return () => {
      b.dispose();
      c.dispose();
    };
  }, []);

  const elapsed = useElapsed(
    describeConsoleStatus(flow).tone === "running",
    flow.build === "running" ? flow.buildStartedAt : null
  );
  const described = describeConsoleStatus(flow, elapsed);
  // The hint asks for a client run; once one has started, it has done its job
  const status = hasClientRun ? withoutClientRunHint(described) : described;
  const stop = runToStop(flow);

  const [progress, setProgress] = useState(0);
  useSetStatic(PgView.events.MAIN_SECONDARY_PROGRESS_SET, setProgress);

  // What `PgTerminal.process` needs to know whether a failure it printed
  // was seen
  useEffect(() => {
    PgTerminal.setConsoleOpen(open);
    return () => PgTerminal.setConsoleOpen(false);
  }, [open]);

  // Copy takes the log as it is when the console opens and again whenever a
  // run's stage moves: a deploy opens the console before it has printed, and
  // the run's whole text lands only as it ends
  // TODO(intake: interface-2 carry review, PR 379): output a client Run or a typed
  // command prints after the status settles is not re-read; reading at the
  // click needs a value getter on the design system's CopyButton
  const [logText, setLogText] = useState("");
  useEffect(() => {
    if (!open) return;
    let live = true;
    PgTerminal.get()
      .then((term) => {
        if (live) setLogText(term.getText());
      })
      .catch((error: unknown) =>
        log.error(error, { context: { action: "read the log for Copy" } })
      );
    return () => {
      live = false;
    };
  }, [open, flow.build, flow.deploy]);

  const clear = () => {
    PgTerminal.clear()
      // A cleared log has nothing left to copy
      .then(() => setLogText(""))
      .catch((error: unknown) =>
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
      status={tutorial?.status ?? status}
      progress={progress}
      bare={tutorial !== undefined}
      empty={tutorial?.empty}
      // A tutorial below the frame's width is the phone's: no key hints
      shortcut={
        tutorial && viewport !== "wide"
          ? undefined
          : keyLabel(CONSOLE_KEY, PgCommon.getOS())
      }
      onClear={clear}
      log={logText}
      stop={stop && { run: stop, onStop: () => PgCommandManager.stop() }}
    >
      <Terminal />
    </BaseConsoleDrawer>
  );
};

export default ConsoleDrawer;
