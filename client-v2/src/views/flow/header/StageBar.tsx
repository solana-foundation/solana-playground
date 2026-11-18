import type { FC } from "react";
import { useEffect, useState } from "react";

import { PgClientRun, RunButton } from "@/features/docs-link";
import { useViewport } from "@/shared/lib/hooks/use-viewport";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { ClientProjectBar } from "@/widgets/client-project-bar";

import { useKeybind } from "../../../hooks";
import type { FlowState } from "../state/stage";
import { INITIAL_FLOW_STATE, PgFlow, STAGES, stagesOf } from "../state/stage";
import Stepper from "./Stepper";

/**
 * The dev-loop stepper: in the frame, a full-width row of stage tabs at the
 * top of the work, across the files column and the stage (`LayoutShell`'s
 * `stageTabs`, design.md "Frame chrome (5.25)"); on a phone, across the
 * preview page's bar, without Write, which is the code's own page there. It
 * owns the Ctrl+1..4 stage keys; Flow does not mount it before a tutorial's
 * Start (`useStagesOffered`), so no stage can be reached then. A project with
 * no program offers only Write, so the other keys do nothing. Its row draws
 * no stepper, since one lone Write tab read as broken: `ClientProjectBar`
 * takes its place, the tree's own Run and Test being hidden (`LeftPanel`). On a phone, the bar keeps only the label and
 * Run. The project list and the session footer live in the navigation
 * (`AppNav`), not here.
 */
const StageBar: FC = () => {
  const [state, setState] = useState<FlowState>(INITIAL_FLOW_STATE);
  useEffect(() => PgFlow.onDidChange(setState).dispose, []);
  // Every run is shown and measured, in a project with a program too
  useEffect(() => PgClientRun.follow(), []);

  // Cmd/Ctrl+1..4 jump to a stage. `PgKeybind` folds `metaKey` into CTRL, so
  // one binding covers both platforms.
  useKeybind(
    STAGES.map((stage, i) => ({
      keybind: `Ctrl+${i + 1}`,
      handle: () => {
        // A stage the open project does not offer has no tab to go to
        if (!stagesOf(PgFlow.state).includes(stage)) return false;
        PgFlow.setStage(stage);
        // Focus follows the shortcut, so the keyboard user lands on the tab
        // they just selected rather than being left wherever they were
        document.getElementById(`flow-stage-tab-${stage}`)?.focus();
      },
    })),
    []
  );

  const row = useViewport() !== "phone";
  if (row && !state.hasProgram) return <ClientProjectBar />;

  return (
    <div
      className={cn(
        // The stepper's thumb and items stack with z-index; `isolate` keeps
        // them inside the row, so they never rise over a window opened above
        // the work area (the wallet, z-index 30), which the full-width row
        // reaches
        "isolate flex min-w-0 shrink-0 items-center justify-center gap-2 bg-transparent font-sans",
        // In the frame, the work's top row: 44 px like the assistant's head,
        // so their lines meet, the 34 px stepper centred in it. On a phone,
        // across the preview page's bar
        row ? "h-11 border-b border-border px-2" : "flex-1"
      )}
    >
      <Stepper
        state={state}
        onSelect={PgFlow.setStage}
        fill={row}
        phone={!row}
      />
      {!state.hasProgram && (
        <>
          <Badge variant="outline" id="flow-client-project">
            Client project
          </Badge>
          <RunButton />
        </>
      )}
    </div>
  );
};

export default StageBar;
