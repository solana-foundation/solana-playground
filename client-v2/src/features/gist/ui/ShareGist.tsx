import { useEffect, useRef, useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import { PgView } from "@/utils/view";

import { GIST_SCOPE } from "../config.mjs";
import { shareFilesOf } from "../lib/format";
import { playgroundLink } from "../lib/playground-link";
import type { ExportResult } from "../model/export";
import { exportProjectWith } from "../model/export";
import type {
  GistExportFailure,
  GistShareSource,
  GistVisibility,
} from "../model/telemetry";
import { gistTelemetry } from "../model/telemetry";
import type {
  BaseShareGistProps,
  ShareStep,
  SignInEnding,
} from "./BaseShareGist";

const log = createLogger("gist:share");

export interface ShareGistOptions {
  /** The project's name */
  name: string;
  /** The project's files, keyed by path relative to its root */
  readFiles: () => Promise<Record<string, string>>;
  /** Where the dialog was opened, for telemetry */
  source: GistShareSource;
  /**
   * Whether someone is signed in. A value the caller keeps current: the
   * dialog can open before the page's first session read has answered.
   */
  signedIn: boolean;
  /**
   * Sign in with GitHub, asking for `scopes` on top of sign-in's own. Passed
   * in because this feature may not import `auth`. Answers `"cancelled"`
   * when the user ended it (here or on GitHub), and rejects, with a message
   * fit to show, when it failed.
   */
  signIn: (options?: {
    scopes?: string[];
  }) => Promise<"signed-in" | "cancelled">;
  /**
   * Stop the sign-in under way, so the `signIn` it started answers
   * `"cancelled"`. Passed in for the same reason as `signIn`.
   */
  cancelSignIn: () => void;
  /** The page's origin, which the Playground link opens under */
  origin?: string;
}

/** What the dialog's frame needs: the body's props and the actions' runs */
export interface ShareGistControl {
  body: Omit<BaseShareGistProps, "githubMark">;
  run: {
    create: () => Promise<void>;
    "sign-in": () => Promise<void>;
    grant: () => Promise<void>;
    "cancel-sign-in": () => void;
    /** Copy the Playground link; answers whether it reached the clipboard */
    copy: () => Promise<boolean>;
  };
}

/** What the dialog says after a sign-in the user ended */
const SIGN_IN_CANCELLED = "Sign-in cancelled.";

/**
 * What a failed sign-in says: its own words, or Spec 08's "Could not sign in."
 * when it has none. The sign-in prompt before sharing says the same.
 */
export const signInFailureMessage = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : "Could not sign in.";

/** The toast a copy that reached the clipboard shows */
const LinkCopied = () => <span>Link copied</span>;

/**
 * The share dialog, connected: signs in when it must, asks for gist access
 * when the token lacks it, copies the link it hands out, and counts how each
 * share ends. The frame draws `shareAction` of the body's state in its
 * footer and calls `run` with it.
 */
export const useShareGist = ({
  name,
  readFiles,
  source,
  signedIn,
  signIn,
  cancelSignIn,
  origin = window.location.origin,
}: ShareGistOptions): ShareGistControl => {
  const [state, setState] = useState<ShareStep>({ step: "ready" });
  // Secret on every open (Spec 05); a retry after a sign-in or a grant reads
  // the choice from here, so it keeps what the user picked
  const [visibility, setVisibility] = useState<GistVisibility>("secret");
  const [busy, setBusy] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [files, setFiles] = useState<BaseShareGistProps["files"]>();
  // A dialog closed mid-share must not have state set on it. Set in the effect,
  // not only at first render: StrictMode runs the cleanup and the effect
  // again on mount, and a ref left `false` drops every answer
  const mounted = useRef(true);
  // Whether this dialog's own sign-in or grant waits on GitHub's popup
  const isSigningIn = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Closed while the popup waits: the user gave up on sharing, so the
      // sign-in ends here and nothing is published behind the closed dialog
      // eslint-disable-next-line react-hooks/exhaustive-deps -- the wait as it stands at close is what counts, not at mount
      if (isSigningIn.current) cancelSignIn();
    };
    // Mount and unmount only: the caller passes a fresh `cancelSignIn` on
    // each render, and every one ends the same session sign-in
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, []);
  const show = (next: ShareStep) => {
    if (mounted.current) setState(next);
  };
  const failed = (reason: GistExportFailure) =>
    gistTelemetry.track("gist_export_failed", { reason, visibility });

  // What goes to the gist, for the folded list; the export reads again
  useEffect(() => {
    readFiles()
      .then((read) => {
        if (mounted.current) setFiles(shareFilesOf({ name, files: read }));
      })
      .catch((e: unknown) => {
        // Only the folded list goes without it: the export reads the files
        // again and fails there, where the user sees why
        log.warn("could not read the project for the file list", {
          context: { error: String(e) },
        });
        if (mounted.current) setFiles({ paths: [], bytes: 0 });
      });
  }, [name, readFiles]);

  /** One export; `afterGrant` says the user has just allowed gists */
  const share = async ({ afterGrant }: { afterGrant: boolean }) => {
    if (mounted.current) setBusy(true);
    let result: ExportResult;
    try {
      result = await exportProjectWith(visibility)(source)({
        name,
        files: await readFiles(),
      });
    } finally {
      if (mounted.current) setBusy(false);
    }
    switch (result.status) {
      case "created":
        show({
          step: "created",
          url: result.url,
          link: playgroundLink(origin, result.id),
        });
        return;
      case "needs-sign-in":
        failed("signed-out");
        // With its reason, so the step holds while this page still thinks
        // the session it lost is there
        show({
          step: "sign-in",
          ended: {
            kind: "failed",
            message: "Your session ended. Sign in again to share.",
          },
        });
        return;
      case "needs-gist-scope":
        if (afterGrant) {
          failed("needs-gist-scope");
          show({ step: "failed", reason: "scope-not-granted" });
          return;
        }
        gistTelemetry.track("gist_export_scope_requested", {});
        show({ step: "grant" });
        return;
      case "failed":
        failed(result.reason);
        show({ step: "failed", reason: result.reason });
        return;
    }
  };

  const signInThen = async (
    retry: (ended: SignInEnding) => ShareStep,
    scopes: string[] | undefined
  ) => {
    show({ step: "waiting", for: scopes ? "grant" : "sign-in" });
    let ended: SignInEnding | undefined;
    isSigningIn.current = true;
    try {
      if ((await signIn(scopes ? { scopes } : undefined)) === "cancelled") {
        // The user's own doing, said quietly
        ended = { kind: "cancelled", message: SIGN_IN_CANCELLED };
      }
    } catch (e) {
      ended = { kind: "failed", message: signInFailureMessage(e) };
    } finally {
      isSigningIn.current = false;
    }
    // A sign-in that settles after the dialog closed shares nothing: the
    // user left before it answered
    if (!mounted.current) return;
    if (ended) {
      // `signIn` counted its own ending (`auth_sign_in_failed`); this one is
      // the share's, a cancel included
      failed("sign-in-failed");
      show(retry(ended));
      return;
    }
    show({ step: "ready" });
    await share({ afterGrant: !!scopes });
  };

  const copy = async () => {
    if (state.step !== "created") return false;
    try {
      await navigator.clipboard.writeText(state.link);
    } catch (e) {
      // A refused clipboard is the browser's answer, not a fault of ours:
      // the dialog says so and the link stays selectable
      log.warn("clipboard refused the link", {
        context: { error: String(e) },
      });
      if (mounted.current) setCopyFailed(true);
      return false;
    }
    if (mounted.current) setCopyFailed(false);
    PgView.setToast(LinkCopied, { options: { name: "gist-link-copied" } });
    gistTelemetry.track("gist_link_copied", { copied: "playground" });
    return true;
  };

  // Until a step has its own answer, the session decides what is offered: a
  // sign-in elsewhere, or the first session read, moves the dialog along
  let shown = state;
  const isUndecided =
    state.step === "ready" || (state.step === "sign-in" && !state.ended);
  if (isUndecided) shown = signedIn ? { step: "ready" } : { step: "sign-in" };

  return {
    body: {
      name,
      state: shown,
      visibility,
      onVisibilityChange: setVisibility,
      busy,
      files,
      copyFailed,
    },
    run: {
      create: () => share({ afterGrant: false }),
      "sign-in": () =>
        signInThen((ended) => ({ step: "sign-in", ended }), undefined),
      grant: () =>
        signInThen((ended) => ({ step: "grant", ended }), [GIST_SCOPE]),
      "cancel-sign-in": cancelSignIn,
      copy,
    },
  };
};
