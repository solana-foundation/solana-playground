import { useEffect, useState } from "react";

import type { LinkState } from "../model/opened";
import { PgDocsLink } from "../model/opened";
import type { RunState } from "../model/run";
import { PgClientRun } from "../model/run";

/** @returns the stage row's run state, kept current */
export const useRunState = (): RunState => {
  const [state, setState] = useState(PgClientRun.state);
  useEffect(() => PgClientRun.onDidChange(setState).dispose, []);
  return state;
};

/** @returns where the open view came from, kept current */
export const useLinkState = (): LinkState => {
  const [state, setState] = useState(PgDocsLink.state);
  useEffect(() => PgDocsLink.onDidChange(setState).dispose, []);
  return state;
};
