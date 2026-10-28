import { useEffect, useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import { isSignInFailure, PgSession } from "../../../features/auth";
import { PgSyncClient } from "../../../features/persistence";
import { assistantTelemetry } from "./telemetry";

const log = createLogger("assistant:sign-in-offer");

/** What the thread's sign-in line needs */
export interface SignInOffer {
  /** A sign-in is under way, from here or anywhere else */
  pending: boolean;
  onSignIn: () => void;
}

/**
 * The session as the line sees it. `unread` until the page's own read has
 * answered: before it `get()` is `null` for everyone, and the line would flash
 * at a signed-in person while their cookie is restored.
 */
type Session = "unread" | { signedOut: boolean; pending: boolean };

/**
 * `assistant-sign-out-history` (from the designers' Spec 08): a signed-out thread with something in it
 * ends in an offer to sign in and keep it on other devices. Returns `null`
 * when the line is not shown.
 *
 * Only where the deployment syncs: without a database, signing in keeps
 * nothing anywhere, and the line would say it does. Sync is asked once per
 * mount; a probe with no answer hides the line until the panel mounts again.
 */
export const useSignInOffer = ({
  hasItems,
}: {
  /** The open thread holds anything: an empty one has nothing to keep */
  hasItems: boolean;
}): SignInOffer | null => {
  const [session, setSession] = useState<Session>("unread");
  const [syncs, setSyncs] = useState(false);

  useEffect(() => {
    let live = true;
    let ready = false;
    const read = () =>
      setSession({
        signedOut: !PgSession.get(),
        pending: PgSession.signInState().status === "pending",
      });
    // `afterRead`, never `whenRead`: the panel can mount before the session
    // effect, and a read started here would hide the account's sign-in from it
    void PgSession.afterRead().then(() => {
      if (!live) return;
      ready = true;
      read();
    });
    // `available` never rejects: a probe that fails answers `false`
    void PgSyncClient.available().then((answer) => {
      if (live) setSyncs(answer);
    });
    // A sign-in started elsewhere notifies before the first read has answered
    const sub = PgSession.onDidChange(() => {
      if (ready) read();
    });
    return () => {
      live = false;
      sub.dispose();
    };
  }, []);

  if (session === "unread" || !session.signedOut || !syncs || !hasItems) {
    return null;
  }
  return { pending: session.pending, onSignIn: signIn };
};

const signIn = () => {
  assistantTelemetry.track("assistant_sign_in_offered_clicked", {});
  // From the assistant, so the account's newest project does not open over the
  // one this conversation is about
  PgSession.signIn({ from: "assistant" }).catch((error: unknown) => {
    // `PgSession.signInState` holds every failure and the account row shows
    // it; `auth` telemetry has its reason
    if (isSignInFailure(error)) {
      log.info("sign-in from the thread failed", {
        context: { error: String(error) },
      });
      return;
    }
    log.error(error, { report: true, context: { from: "thread" } });
  });
};
