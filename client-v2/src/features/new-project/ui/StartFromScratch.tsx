import { useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import { PgExplorer, PgFramework } from "@/utils";
import { newProjectTelemetry } from "../model/telemetry";
import BaseStartFromScratch, { canStart } from "./BaseStartFromScratch";
import type { Start } from "./BaseStartFromScratch";

const log = createLogger("new-project:start");

const defaultName = (framework: FrameworkName) =>
  `${framework.toLowerCase()}-project`;

export interface StartFromScratchProps {
  /**
   * Runs once a project has been made: New project closes its dialog here.
   * Home passes nothing, since the new project replaces Home by itself
   */
  onStarted?: () => void;
  /** Something else runs (an Open in New project): Start waits for it */
  held?: boolean;
  /** Hears when making a project starts and ends, so others can wait */
  onRunning?: (running: boolean) => void;
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
      setStart({ state: "invalid", error: "Invalid project name" });
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
      setStart({
        state: "failed",
        error: e instanceof Error ? e.message : "Could not create the project",
      });
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
