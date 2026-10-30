import { useEffect, useState } from "react";

import { useElapsed } from "@/shared/lib/hooks/use-elapsed";

import BaseBuild from "./BaseBuild";
import IdlActions from "./IdlActions";
import { buildSurface, ownOutput } from "./build-surface";
import { failedView } from "./build-view";
import { PgBuildOutput } from "../../sidebar/assistant/bridge/build-output";
import type { BuildOutput } from "../../sidebar/assistant/bridge/build-output";
import { PgAssistant } from "../../sidebar/assistant/store";
import { PgFlow } from "../state/stage";
import type { FlowState } from "../state/stage";
import { PgCommand, PgExplorer, PgFramework, PgSettings } from "../../../utils";

/**
 * The build server's host, for naming it in the UI. Falls back to the raw
 * setting: the value is parsed as a URL when it is set, but this also runs
 * on the surface that reports an unreachable server, where throwing would
 * replace the diagnosis with a blank stage.
 */
const serverHost = () => {
  const endpoint = PgSettings.server.endpoint;
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
};

/** The Build stage, connected: the flow, this workspace's report, commands */
const Build = () => {
  const [out, setOut] = useState<BuildOutput | null>(null);
  const [flow, setFlow] = useState<FlowState>(PgFlow.state);

  useEffect(() => {
    const a = PgBuildOutput.onDidChange(setOut);
    const b = PgFlow.onDidChange(setFlow);
    return () => {
      a.dispose();
      b.dispose();
    };
  }, []);

  const elapsedMs = useElapsed(
    flow.build === "running" ? flow.buildStartedAt : null
  );
  const own = ownOutput(out, PgExplorer.currentWorkspaceName ?? null);
  const surface = buildSurface({ flow, own });

  return (
    <BaseBuild
      surface={
        surface.kind === "failed"
          ? {
              kind: "failed",
              ...failedView(
                surface.stderr,
                flow.buildErrorCount,
                (path) => PgExplorer.getFileContent(path) ?? null
              ),
            }
          : surface
      }
      building={flow.build === "running"}
      host={serverHost()}
      ms={flow.buildMs}
      elapsedMs={elapsedMs}
      onBuild={() => PgCommand.build.execute()}
      onContinue={() => PgFlow.setStage("deploy")}
      onExport={() => PgFramework.exportWorkspace()}
      onFix={(prompt) => PgAssistant.requestPrompt(prompt)}
      onOpenFile={(path) => PgExplorer.openFile(path)}
      idlActions={<IdlActions mode="download" />}
    />
  );
};

export default Build;
