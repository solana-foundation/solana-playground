import type { FC } from "react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";

import { PgClientRun } from "../model/run";
import BaseRunCallout from "./BaseRunCallout";
import { useLinkState, useRunState } from "./use-run-state";

/** The note above the code of a project with no program, connected */
const RunCallout: FC = () => {
  const state = useRunState();
  // "This link is broken" opened no project: there is nothing to run
  const link = useLinkState();
  // eslint-disable-next-line unicorn/no-null -- a component that draws nothing returns `null`; React's types refuse `undefined`
  if (link.kind === "broken") return null;
  return (
    <BaseRunCallout
      state={state}
      source={
        link.kind === "opened"
          ? { title: link.link.title, from: link.link.from }
          : undefined
      }
      onRunAgain={() => {
        PgClientRun.start().catch(reportButtonFailure("run the script"));
      }}
      onCheckAgain={() => {
        PgClientRun.checkAgain().catch(
          reportButtonFailure("check the balance")
        );
      }}
      onNotNow={PgClientRun.dismissFunding}
      onCopyError={reportButtonFailure("copy the address")}
    />
  );
};

export default RunCallout;
