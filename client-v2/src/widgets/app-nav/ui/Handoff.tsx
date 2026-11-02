import { useState, useSyncExternalStore } from "react";

import { isSignInFailure, PgSession } from "@/features/auth";
import { createLogger } from "@/shared/lib/logger";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";

import { navTelemetry } from "../model/telemetry";
import type { HandoffAccount } from "./BaseHandoff";
import BaseHandoff, { HANDOFF_TITLE } from "./BaseHandoff";

const log = createLogger("app-nav:handoff");

const subscribe = (onChange: () => void) =>
  PgSession.onDidChange(onChange).dispose;

/**
 * The session as one snapshot string, so the login and the sign-in's state
 * are read together and a render never mixes two moments of it
 */
const snapshot = () => {
  const login = PgSession.get()?.login ?? null;
  const state = PgSession.signInState();
  const message = state.status === "failed" ? state.message : null;
  return JSON.stringify([login, state.status === "pending", message]);
};

/** Who the sheet speaks to, re-read when the session moves */
const useAccount = (): HandoffAccount => {
  const [login, signingIn, error] = JSON.parse(
    useSyncExternalStore(subscribe, snapshot)
  ) as [string | null, boolean, string | null];
  return login === null
    ? { status: "signed-out", signingIn, error }
    : { status: "signed-in", login };
};

/**
 * This page's address: the app's origin and the current path. A project has
 * no address of its own; signed in, the account's project list opens it on
 * the computer, and a tutorial's path opens that tutorial
 */
const linkHere = () => `${window.location.origin}${window.location.pathname}`;

/** A share sheet the user closed rejects too, and is not a failure */
const isCancelledShare = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

const reportCopy = reportButtonFailure("copy the link");
const reportShare = reportButtonFailure("share the link");
const reportSignIn = reportButtonFailure("sign in with GitHub");

/** `BaseHandoff` with the session, the clipboard and the share sheet */
const Handoff = () => {
  const [open, setOpen] = useState(false);
  const account = useAccount();
  // Read on opening, not on every render: the sheet shows the page it was opened on
  const [link, setLink] = useState(linkHere);

  const onOpenChange = (next: boolean) => {
    if (next) {
      setLink(linkHere());
      navTelemetry.track("nav_handoff_opened", {
        signedIn: account.status === "signed-in",
      });
    }
    setOpen(next);
  };

  const onCopy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("No clipboard in this browser");
      await navigator.clipboard.writeText(link);
    } catch (error) {
      reportCopy(error);
      return false;
    }
    navTelemetry.track("nav_handoff_link_copied", {});
    return true;
  };

  const onShare = async () => {
    try {
      // `onShare` is offered only where `navigator.share` exists
      await navigator.share({ title: HANDOFF_TITLE, url: link });
    } catch (error) {
      if (isCancelledShare(error)) return;
      reportShare(error);
      return;
    }
    navTelemetry.track("nav_handoff_link_shared", {});
  };

  const onSignIn = () => {
    PgSession.signIn().catch((error: unknown) => {
      // A known failure (the popup closed, GitHub refused) is in
      // `PgSession.signInState`, whose message the sheet shows under the
      // button, and `auth` telemetry has its reason
      if (isSignInFailure(error)) {
        log.info("sign-in failed", { context: { error: String(error) } });
        return;
      }
      log.error(error, { report: true, context: { from: "handoff" } });
      reportSignIn(error);
    });
  };

  return (
    <BaseHandoff
      open={open}
      onOpenChange={onOpenChange}
      link={link}
      account={account}
      onSignIn={onSignIn}
      onCopy={onCopy}
      onShare={typeof navigator.share === "function" ? onShare : null}
    />
  );
};

export default Handoff;
