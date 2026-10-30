import { PgSession } from "@/features/auth";
import { createLogger } from "@/shared/lib/logger";
import { PgExplorer, PgFramework, PgTutorial } from "@/utils";
import { runExample } from "../model/example";
import { useSessionRetry } from "../model/session-retry";
import { useVisit } from "../model/use-visit";
import { needsSessionRetry } from "../model/visit";
import { homeTelemetry } from "../model/telemetry";
import type { PageTile } from "../model/telemetry";
import { useProgramCount } from "../model/use-program-count";
import { toastActionFailed } from "./action-failed-toast";
import BasePhoneHome from "./BasePhoneHome";
import type { PhoneQuickstart, QuickstartTarget } from "./BasePhoneHome";

export interface PhoneHomeProps {
  onAsk: () => void;
  /** Continue was picked: go back to the project open under Home */
  onContinue: () => void;
  /** Open the Tutorials or Programs page, in Home's place */
  onOpenPage: (page: PageTile) => void;
}

const log = createLogger("home:actions");

const newFramework = () =>
  PgFramework.all.find((f) => f.name === "Anchor") ?? PgFramework.all[0];

/** `anchor-project`, or `anchor-project-2` and on when the name is taken */
const freeProjectName = (framework: string) => {
  const taken = PgExplorer.allWorkspaceNames ?? [];
  const base = `${framework.toLowerCase()}-project`;
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base}-${n}`;
  return name;
};

/**
 * Open what a quick start names. Its target was read when Home drew it, so
 * one gone since (a project deleted in another tab) throws rather than
 * passing for an open.
 */
const openQuickstart = async (
  target: QuickstartTarget,
  onContinue: () => void
) => {
  switch (target.id) {
    case "example": {
      const outcome = await runExample();
      if (outcome === "current") onContinue();
      homeTelemetry.track("home_example_run", { outcome });
      return;
    }
    case "continue": {
      if (!PgExplorer.allWorkspaceNames?.includes(target.workspace)) {
        throw new Error(`${target.workspace} no longer exists.`);
      }
      // Continue names the project open when Home drew it, which the work
      // under Home still holds; a switch would re-read it under a live
      // editor. Only one opened since (another tab) needs the switch.
      if (target.workspace === PgExplorer.currentWorkspaceName) onContinue();
      else await PgExplorer.switchWorkspace(target.workspace);
      return;
    }
    case "new": {
      const framework = PgFramework.get(target.framework);
      if (!framework) {
        throw new Error(`${target.framework} is not available.`);
      }
      const { files } = await framework.getDefaultFiles();
      await PgExplorer.createWorkspace(freeProjectName(target.framework), {
        files,
        defaultOpenFile: framework.defaultOpenFile,
      });
      return;
    }
    case "tutorial": {
      if (!PgTutorial.all.some((t) => t.name === target.name)) {
        throw new Error(`${target.name} is not available.`);
      }
      await PgTutorial.open(target.name);
      return;
    }
  }
};

const PhoneHome = ({ onAsk, onContinue, onOpenPage }: PhoneHomeProps) => {
  const visit = useVisit();
  const programCount = useProgramCount();
  // As on desktop: retry a failed account check, never fall back to the example
  const retry = useSessionRetry(
    needsSessionRetry(PgExplorer.allWorkspaceNames, PgSession.readState)
  );

  const framework = newFramework();
  const tutorial = PgTutorial.all.find((t) => t.level === "Beginner");
  const current = PgExplorer.currentWorkspaceName;

  const quickstarts: PhoneQuickstart[] = [];
  // One lead: the example on a first visit (`visitOf`), else the open project
  if (visit === "first") {
    quickstarts.push({
      id: "example",
      title: "Try an example",
      description: "The Anchor starter, built for you",
    });
  } else if (current) {
    quickstarts.push({
      id: "continue",
      workspace: current,
      title: `Continue ${current}`,
      description: "Your last project",
    });
  }
  if (framework) {
    quickstarts.push({
      id: "new",
      framework: framework.name,
      title: `New ${framework.name} project`,
      description: "A working starter you shape with the assistant",
    });
  }
  if (tutorial) {
    quickstarts.push({
      id: "tutorial",
      name: tutorial.name,
      title: tutorial.name,
      description: "Beginner tutorial",
    });
  }

  return (
    <BasePhoneHome
      // One lead, New project and one tutorial: three, the spec's most
      quickstarts={quickstarts}
      tutorialCount={PgTutorial.all.length}
      programCount={programCount}
      onQuickstart={async (quickstart) => {
        try {
          await openQuickstart(quickstart, onContinue);
        } catch (e) {
          // Logged once here and told by a toast, so the button's own
          // `onError` never sees it
          log.error(e, {
            report: true,
            context: { quickstart: quickstart.id },
          });
          toastActionFailed(e);
          return;
        }
        homeTelemetry.track("home_quickstart_opened", { id: quickstart.id });
      }}
      onBrowse={() => onOpenPage("tutorials")}
      onRetrySession={
        retry.kind === "exhausted"
          ? async () => {
              homeTelemetry.track("home_session_retried", {});
              await retry.retry();
            }
          : undefined
      }
      onAsk={() => {
        homeTelemetry.track("home_composer_opened", {});
        onAsk();
      }}
    />
  );
};

export default PhoneHome;
