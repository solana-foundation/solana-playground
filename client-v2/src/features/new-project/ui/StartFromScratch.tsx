import { useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import { PgExplorer, PgFramework } from "@/utils";

import { newProjectTelemetry } from "../model/telemetry";
import type { Start } from "./BaseStartFromScratch";
import BaseStartFromScratch, { canStart } from "./BaseStartFromScratch";

const log = createLogger("new-project:start");

/** What `PgExplorer.isWorkspaceNameValid` lets through, as the field says it */
const NAME_RULE = "Use letters, numbers, spaces, - or _.";

const defaultName = (framework: FrameworkName) =>
  `${framework.toLowerCase()}-project`;

export interface StartFromScratchProps {
  /**
   * Runs once a project has been made: New project closes its page here.
   * Home passes nothing, since the new project replaces Home by itself
   */
  onStarted?: () => void;
  /** Something else runs (an Open in New project): Start waits for it */
  held?: boolean;
  /** Hears when making a project starts and ends, so others can wait */
  onRunning?: (running: boolean) => void;
  /**
   * Hears a failed Start's message, after the field shows it: New project
   * toasts it once its page was left, when no field is left to show it
   */
  onFailed?: (message: string) => void;
}

/**
 * Start from scratch, connected: `PgFramework.get(name).getDefaultFiles()`
 * then `PgExplorer.createWorkspace`, the mechanism the explorer's "Create
 * workspace" uses.
 */
const StartFromScratch = ({
  onStarted,
  held = false,
  onRunning,
  onFailed,
}: StartFromScratchProps) => {
  const [framework, setFramework] = useState<FrameworkName | undefined>(
    PgFramework.all[0]?.name
  );
  const [name, setName] = useState("");
  const [start, setStart] = useState<Start>({ state: "idle" });

  const create = async () => {
    if (!framework || held || !canStart(start)) return;

    const projectName = name.trim() || defaultName(framework);
    if (!PgExplorer.isWorkspaceNameValid(projectName)) {
      // The rule itself, so the message says how to fix the name
      setStart({ state: "invalid", error: NAME_RULE });
      return;
    }

    setStart({ state: "creating" });
    onRunning?.(true);
    try {
      const { getDefaultFiles, defaultOpenFile } = PgFramework.get(framework);
      const { files } = await getDefaultFiles();
      await PgExplorer.createWorkspace(projectName, { files, defaultOpenFile });
    } catch (e) {
      onRunning?.(false);
      log.error(e, { report: true, context: { framework } });
      newProjectTelemetry.track("new_project_start_failed", { framework });
      const error =
        e instanceof Error ? e.message : "Could not create the project";
      setStart({ state: "failed", error });
      onFailed?.(error);
      return;
    }

    // The project exists from here on: nothing below may call it a failure
    onRunning?.(false);
    newProjectTelemetry.track("new_project_started", { framework });
    setStart({ state: "idle" });
    try {
      onStarted?.();
    } catch (e) {
      log.error(e, { report: true, context: { framework, after: "started" } });
    }
  };

  return (
    <BaseStartFromScratch
      frameworks={PgFramework.all.map((f) => ({
        name: f.name,
        icon: f.icon,
        circle: f.circleImage,
      }))}
      framework={framework}
      onFramework={setFramework}
      name={name}
      onName={(next) => {
        setName(next);
        if (start.state !== "creating") setStart({ state: "idle" });
      }}
      placeholder={framework ? defaultName(framework) : "project name"}
      start={start}
      held={held}
      onStart={create}
    />
  );
};

export default StartFromScratch;
