import { useEffect } from "react";

import { PgSession } from "@/features/auth";

import { PgAssistant } from "../store";

/**
 * Ask the gateway which skills and servers it serves, and what those servers
 * offer, on mount and again for each account: the gateway lists `signedIn`
 * sources only to a signed-in caller. The assistant panel and Settings ›
 * Assistant both call it; asking twice is safe.
 */
export const useMcpSources = () => {
  useEffect(() => {
    void PgAssistant.initMcp();
    let user = PgSession.get()?.id;
    return PgSession.onDidChange(() => {
      const next = PgSession.get()?.id;
      // `onDidChange` also fires for a sign-in's progress, which changes no account
      if (next === user) return;
      user = next;
      void PgAssistant.initMcp();
    }).dispose;
  }, []);
};
