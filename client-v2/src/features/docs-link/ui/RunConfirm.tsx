import type { FC } from "react";

import { useViewport } from "@/shared/lib/hooks/use-viewport";

import { PgClientRun } from "../model/run";
import BaseRunConfirm from "./BaseRunConfirm";
import { useRunState } from "./use-run-state";

/**
 * The question before a link's first Run, connected to the run store.
 * Mounted once by the app frame, beside the other dialog hosts: the question
 * can come from Run or from the explorer's menu, and the stage row's Run is
 * not mounted once the project has a program.
 */
const RunConfirm: FC = () => {
  const state = useRunState();
  const isPhone = useViewport() === "phone";
  return (
    <BaseRunConfirm
      link={state.kind === "confirm" ? state.link : undefined}
      isPhone={isPhone}
      onRun={PgClientRun.confirmRun}
      onCancel={PgClientRun.cancelRun}
    />
  );
};

export default RunConfirm;
