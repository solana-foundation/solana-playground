import { useEffect, useState, useSyncExternalStore } from "react";

import { isSignInFailure, PgSession } from "@/features/auth";
import { onDidChangeSyncMarkers, syncMarkerOf } from "@/features/persistence";
import { createLogger } from "@/shared/lib/logger";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { PgExplorer } from "@/utils";

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

/**
 * Whether the account holds the open project as it is here: no sync marker
 * means in sync. Read when the sheet opens and again whenever a marker may
 * have moved, so a sync that lands while it is open changes the line; until
 * the first read, and when it cannot be read, the sheet promises nothing
 */
const useProjectSynced = (open: boolean, login: string | null) => {
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    if (!open || login === null) return;
    let live = true;
    setSynced(false);
    const name = PgExplorer.currentWorkspaceName;
    const id = name ? PgExplorer.workspaceIdOf(name) : undefined;
    // No project open (the phone's Home): nothing here to wait for
    if (!name || !id) {
      setSynced(true);
      return;
    }
    const read = () =>
      syncMarkerOf(id, name)
        .then((marker) => {
          if (live) setSynced(marker === undefined);
        })
        .catch((error: unknown) => {
          // The sheet keeps the honest line; the marker read is reported
          log.warn("hand-off could not read the sync marker", {
            context: { error: String(error) },
          });
        });
    void read();
    const moved = onDidChangeSyncMarkers(() => void read());
    return () => {
      live = false;
      moved.dispose();
    };
  }, [open, login]);
  return synced;
};

/** Who the sheet speaks to, re-read when the session moves */
const useAccount = (open: boolean): HandoffAccount => {
  const [login, signingIn, error] = JSON.parse(
    useSyncExternalStore(subscribe, snapshot)
  ) as [string | null, boolean, string | null];
  const synced = useProjectSynced(open, login);
  return login === null
    ? { status: "signed-out", signingIn, error }
    : { status: "signed-in", login, synced };
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
  const account = useAccount(open);
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
