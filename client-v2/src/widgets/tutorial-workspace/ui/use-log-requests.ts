/* eslint-disable max-params -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import type { RefObject } from "react";
import { useEffect } from "react";

import { PgConversation } from "@/features/tutorial-conversation";

import type { WorkspaceConsole } from "./TutorialWorkspace";

/**
 * A result card's Log opens the drawer, as the learner's own toggle would. It
 * listens only while the workspace is `active`, and does nothing when the
 * drawer is already open. While `box` is under `[inert]` (the phone's Code
 * space with Chat in view, which the same Log switches to) the drawer cannot
 * open yet: the request waits and opens it once `box` is no longer inert.
 */
export const useLogRequests = (
  active: boolean,
  terminal: RefObject<WorkspaceConsole>,
  box: RefObject<HTMLElement | null>
) => {
  useEffect(() => {
    if (!active) return;
    const inert = () => !!box.current?.closest("[inert]");
    const open = () => {
      if (!terminal.current.open) terminal.current.setOpen(true, "button");
    };
    // One request waits at a time; a second press while it waits adds nothing
    let waiting: MutationObserver | undefined;
    const stopWaiting = () => {
      waiting?.disconnect();
      waiting = undefined;
    };
    const sub = PgConversation.onDidRequestLog(() => {
      if (!inert()) return open();
      if (waiting) return;
      // The inert ancestor is set by the layout, above the workspace and
      // out of its renders, so only the DOM says when it lifts
      waiting = new MutationObserver(() => {
        if (inert()) return;
        stopWaiting();
        open();
      });
      waiting.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ["inert"],
      });
    });
    return () => {
      sub.dispose();
      stopWaiting();
    };
  }, [active, terminal, box]);
};
