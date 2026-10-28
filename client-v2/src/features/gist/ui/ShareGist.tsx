import { useEffect, useRef, useState } from "react";

import { GIST_SCOPE } from "../config.mjs";
import { exportProject } from "../model/export";
import type { ExportResult } from "../model/export";
import { gistTelemetry } from "../model/telemetry";
import BaseShareGist from "./BaseShareGist";
import type { ShareStep } from "./BaseShareGist";

export interface ShareGistProps {
  /** The project's name */
  name: string;
  /** The project's files, keyed by path relative to its root */
  readFiles: () => Promise<Record<string, string>>;
  /**
   * Whether someone is signed in. A value the caller keeps current: the
   * dialog can open before the page's first session read has answered.
   */
  signedIn: boolean;
  /**
   * Sign in with GitHub, asking for `scopes` on top of sign-in's own. Passed
   * in because this feature may not import `auth`. Rejects when the user
   * cancels or the sign-in fails, with a message fit to show.
   */
  signIn: (options?: { scopes?: string[] }) => Promise<void>;
}

const messageOf = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "Sign-in failed.";

/**
 * The share dialog's body, connected: signs in when it must, asks for gist
 * access when the token lacks it, and counts how each share ends.
 */
const ShareGist = ({ name, readFiles, signedIn, signIn }: ShareGistProps) => {
  const [state, setState] = useState<ShareStep>({ step: "ready" });
  // A dialog closed mid-share must not have state set on it. Set in the effect,
  // not only at first render: StrictMode runs the cleanup and the effect
  // again on mount, and a ref left `false` drops every answer
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const show = (next: ShareStep) => {
    if (mounted.current) setState(next);
  };

  /** One export; `afterGrant` says the user has just allowed gists */
  const share = async ({ afterGrant }: { afterGrant: boolean }) => {
    const result: ExportResult = await exportProject({
      name,
      files: await readFiles(),
    });
    switch (result.status) {
      case "created":
        show({ step: "created", url: result.url });
        return;
      case "needs-sign-in":
        gistTelemetry.track("gist_export_failed", { reason: "signed-out" });
        // With its reason, so the step holds while this page still thinks
        // the session it lost is there
        show({
          step: "sign-in",
          error: "Your session ended. Sign in again to share.",
        });
        return;
      case "needs-gist-scope":
        if (afterGrant) {
          gistTelemetry.track("gist_export_failed", {
            reason: "needs-gist-scope",
          });
          show({ step: "failed", reason: "scope-not-granted" });
          return;
        }
        gistTelemetry.track("gist_export_scope_requested", {});
        show({ step: "grant" });
        return;
      case "failed":
        gistTelemetry.track("gist_export_failed", { reason: result.reason });
        show({ step: "failed", reason: result.reason });
        return;
    }
  };

  const signInThen = async (
    scopes: string[] | undefined,
    retry: (error: string) => ShareStep
  ) => {
    try {
      await signIn(scopes ? { scopes } : undefined);
    } catch (e) {
      // `signIn` counted its own failure (`auth_sign_in_failed`); this one is
      // the share's
      gistTelemetry.track("gist_export_failed", { reason: "sign-in-failed" });
      show(retry(messageOf(e)));
      return;
    }
    await share({ afterGrant: !!scopes });
  };

  // Until a step has its own answer, the session decides what is offered: a
  // sign-in elsewhere, or the first session read, moves the dialog along
  let shown = state;
  const undecided =
    state.step === "ready" || (state.step === "sign-in" && !state.error);
  if (undecided) shown = signedIn ? { step: "ready" } : { step: "sign-in" };

  return (
    <BaseShareGist
      name={name}
      state={shown}
      onCreate={() => share({ afterGrant: false })}
      onSignIn={() =>
        signInThen(undefined, (error) => ({ step: "sign-in", error }))
      }
      onGrant={() =>
        signInThen([GIST_SCOPE], (error) => ({ step: "grant", error }))
      }
    />
  );
};

export default ShareGist;
