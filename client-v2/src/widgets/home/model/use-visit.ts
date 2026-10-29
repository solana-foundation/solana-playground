import { useEffect } from "react";

import { PgSession } from "@/features/auth";
import { PgAccountList } from "@/features/persistence";
import { useRenderOnChange } from "@/hooks";
import { createLogger } from "@/shared/lib/logger";
import { PgExplorer } from "@/utils";
import { visitOf } from "./visit";
import type { Visit } from "./visit";

const log = createLogger("home:visit");

/**
 * The visit, for both Homes, kept current: the project list changes by a
 * switch, an init, sync's imports or another tab's delete, and the session
 * fires on any change to the user, to how its reads went, or to sign-in;
 * the account's own list is known once the reconcile pass has read it
 */
export const useVisit = (): Visit => {
  useRenderOnChange(PgExplorer.onDidSwitchWorkspace);
  useRenderOnChange(PgExplorer.onDidInit);
  useRenderOnChange(PgExplorer.onDidChangeWorkspaceList);
  useRenderOnChange(PgExplorer.onDidDeleteWorkspace);
  useRenderOnChange(PgSession.onDidChange);
  useRenderOnChange(PgAccountList.onDidChange);
  // Starts the page's first read if nothing has; its result arrives as a change
  useEffect(() => {
    PgSession.whenRead().catch((e: unknown) =>
      // `whenRead` never rejects; should it start to, the team hears of it
      log.error(e, { report: true })
    );
  }, []);
  return visitOf(
    PgExplorer.allWorkspaceNames,
    PgSession.readState,
    PgSession.get() ? PgAccountList.state : "signed-out"
  );
};
