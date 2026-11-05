/* eslint-disable max-params -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import type { RefObject } from "react";
import { useEffect } from "react";

import { PgConversation } from "@/features/tutorial-conversation";

import type { WorkspaceConsole } from "./TutorialWorkspace";

/**
 * A result card's Log opens the drawer, as the learner's own toggle would. It
 * listens only while the workspace is `active`, does nothing when the drawer
 * is already open, and nothing behind a page (`box` under `[inert]`), where
 * the work is not on screen, as the drawer's own auto-open does.
 */
export const useLogRequests = (
  active: boolean,
  terminal: RefObject<WorkspaceConsole>,
  box: RefObject<HTMLElement | null>
) => {
  useEffect(() => {
    if (!active) return;
    const sub = PgConversation.onDidRequestLog(() => {
      if (terminal.current.open) return;
      if (box.current?.closest("[inert]")) return;
      terminal.current.setOpen(true, "button");
    });
    return () => sub.dispose();
  }, [active, terminal, box]);
};
