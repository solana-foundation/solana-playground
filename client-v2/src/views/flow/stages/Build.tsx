import { useEffect, useState } from "react";

import { PgSession } from "@/features/auth";
import { DownloadProgram } from "@/features/cli-deploy";
import { IdlBuildGuide } from "@/features/idl-build-guide";
import { useElapsed } from "@/shared/lib/hooks/use-elapsed";
import { useOnline } from "@/shared/lib/hooks/use-online";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { requestConsole } from "@/widgets/layout-shell";

import { useRenderOnChange } from "../../../hooks";
import {
  PgCommand,
  PgCommandManager,
  PgExplorer,
  PgProgramInfo,
  PgSettings,
} from "../../../utils";
import type { BuildOutput } from "../../sidebar/assistant/bridge/build-output";
import { PgBuildOutput } from "../../sidebar/assistant/bridge/build-output";
import { PgAssistant } from "../../sidebar/assistant/store";
import type { FlowState } from "../state/stage";
import { PgFlow } from "../state/stage";
import BaseBuild from "./BaseBuild";
import { buildSurface, ownOutput } from "./build-surface";
import { failedView } from "./build-view";
import IdlActions, { loadIdlFile, openInteract } from "./IdlActions";
import { toldByStage } from "./stage-failure";
import { useSlowBuild } from "./use-slow-build";

/**
 * The build server's host, for naming it in the UI. Falls back to the raw
 * setting: the value is parsed as a URL when it is set, but this also runs
 * on the surface that reports an unreachable server, where throwing would
 * replace the diagnosis with a blank stage.
 */
const serverHost = () => {
  const endpoint = PgSettings.server.endpoint;
  try {
    // The default is a path on this origin (`/api/build-server`)
    return new URL(endpoint, window.location.href).host;
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

  const building = flow.build === "running";
  const slow = useSlowBuild(building, flow.buildStartedAt);
  const elapsedMs = useElapsed(
    building ? flow.buildStartedAt ?? undefined : undefined
  );
  const online = useOnline();
  const own = ownOutput(out, PgExplorer.currentWorkspaceName ?? null);
  const surface = buildSurface({ flow, own });
  const idl = useRenderOnChange(PgProgramInfo.onDidChangeIdl);

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
      building={building}
      slow={slow}
      host={serverHost()}
      serverUrl={PgSettings.server.endpoint}
      ms={flow.buildMs}
      elapsedMs={elapsedMs}
      offline={!online}
      // The stage's catch rethrows; BaseBuild's buttons report what is left
      onBuild={() => PgCommand.build.execute().catch(toldByStage("build"))}
      onContinue={() => PgFlow.setStage("deploy")}
      hasIdl={!!idl}
      sourceChanged={flow.sourceChanged}
      onAsk={(prompt) => PgAssistant.requestPrompt(prompt)}
      onOpenFile={(path) => PgExplorer.openFile(path)}
      onShowLog={requestConsole}
      // The console's own Stop. When nothing stoppable runs, the terminal
      // says why, so the console opens to show it
      onStop={() => {
        if (!PgCommandManager.stop()) requestConsole();
      }}
      idlActions={
        <>
          <IdlActions mode="download" look="link" />
          <DownloadProgram from="build-stage" look="link" />
        </>
      }
      onSignIn={async () => {
        const workspace = PgExplorer.currentWorkspaceName;
        // With an origin, so the session effect keeps this project open
        // instead of the account's latest
        await PgSession.signInFor("build")([]);
        // A closed popup resolves with nobody signed in: building would
        // only be refused again
        if (!PgSession.get()) return;
        // The popup can stay open long enough to move elsewhere: the build
        // was asked for this project, not whichever is open now
        if (PgExplorer.currentWorkspaceName !== workspace) return;
        // Not awaited: a failed build is the build's to report, never the
        // sign-in button's
        PgCommand.build
          .execute()
          .catch(toldByStage("build"))
          .catch(reportButtonFailure("build"));
      }}
      idlGuide={
        <IdlBuildGuide
          surface="build"
          onLoadIdl={loadIdlFile}
          onInteract={openInteract}
        />
      }
    />
  );
};

export default Build;
