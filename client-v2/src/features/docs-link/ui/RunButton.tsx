import type { FC } from "react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";

import type { RunState } from "../model/run";
import { PgClientRun } from "../model/run";
import BaseRunButton from "./BaseRunButton";
import { useLinkState, useRunState } from "./use-run-state";

const ENDED: ReadonlySet<RunState["kind"]> = new Set<RunState["kind"]>([
  "done",
  "failed",
  "missing-package",
]);

/** Whether the project has run: the funding card keeps the run before it */
const hasRun = (state: RunState) =>
  ENDED.has(state.kind === "funding" ? state.previous.kind : state.kind);

/** The stage row's Run, connected to the run store */
const RunButton: FC = () => {
  const state = useRunState();
  // "This link is broken" opened no project: there is nothing to run
  const link = useLinkState();
  // eslint-disable-next-line unicorn/no-null -- a component that draws nothing returns `null`; React's types refuse `undefined`
  if (link.kind === "broken") return null;
  return (
    <BaseRunButton
      running={state.kind === "running"}
      ran={hasRun(state)}
      onRun={() => {
        PgClientRun.start().catch(reportButtonFailure("run the script"));
      }}
    />
  );
};

export default RunButton;
