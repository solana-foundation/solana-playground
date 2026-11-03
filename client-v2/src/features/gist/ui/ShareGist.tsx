import { useEffect, useRef, useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import { PgView } from "@/utils/view";
import { GIST_SCOPE } from "../config.mjs";
import { playgroundLink } from "../lib/playground-link";
import { exportProjectWith } from "../model/export";
import type { ExportResult } from "../model/export";
import { gistTelemetry } from "../model/telemetry";
import type {
  GistCopiedLink,
  GistExportFailure,
  GistShareSource,
  GistVisibility,
} from "../model/telemetry";
import BaseShareGist from "./BaseShareGist";
import type { ShareStep, SignInEnding } from "./BaseShareGist";

const log = createLogger("gist:share");

export interface ShareGistProps {
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

/** What the dialog says after a sign-in the user ended */
const SIGN_IN_CANCELLED = "Sign-in cancelled.";

const messageOf = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "Sign-in failed.";

/** The toast a copy that reached the clipboard shows */
const LinkCopied = () => <span>Link copied</span>;

/**
 * The share dialog's body, connected: signs in when it must, asks for gist
 * access when the token lacks it, copies the links it hands out, and counts
 * how each share ends.
 */
const ShareGist = ({
  name,
  readFiles,
  source,
  signedIn,
  signIn,
  cancelSignIn,
  origin = window.location.origin,
}: ShareGistProps) => {
  const [state, setState] = useState<ShareStep>({ step: "ready" });
  // Secret on every open (Spec 05); a retry after a sign-in or a grant reads
  // the choice from here, so it keeps what the user picked
  const [visibility, setVisibility] = useState<GistVisibility>("secret");
  const [busy, setBusy] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
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
  const failed = (reason: GistExportFailure) =>
    gistTelemetry.track("gist_export_failed", { reason, visibility });

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
    try {
      if ((await signIn(scopes ? { scopes } : undefined)) === "cancelled") {
        // The user's own doing, said quietly
        ended = { kind: "cancelled", message: SIGN_IN_CANCELLED };
      }
    } catch (e) {
      ended = { kind: "failed", message: messageOf(e) };
    }
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

  const copy = async (link: GistCopiedLink) => {
    if (state.step !== "created") return;
    const value = link === "playground" ? state.link : state.url;
    try {
      await navigator.clipboard.writeText(value);
    } catch (e) {
      // A refused clipboard is the browser's answer, not a fault of ours:
      // the dialog says so and the link stays selectable
      log.warn("clipboard refused the link", {
        context: { error: String(e) },
      });
      if (mounted.current) setCopyFailed(true);
      return;
    }
    if (mounted.current) setCopyFailed(false);
    PgView.setToast(LinkCopied, { options: { name: "gist-link-copied" } });
    gistTelemetry.track("gist_link_copied", { copied: link });
  };

  // Until a step has its own answer, the session decides what is offered: a
  // sign-in elsewhere, or the first session read, moves the dialog along
  let shown = state;
  const isUndecided =
    state.step === "ready" || (state.step === "sign-in" && !state.ended);
  if (isUndecided) shown = signedIn ? { step: "ready" } : { step: "sign-in" };

  return (
    <BaseShareGist
      name={name}
      state={shown}
      visibility={visibility}
      onVisibilityChange={setVisibility}
      busy={busy}
      onCreate={() => share({ afterGrant: false })}
      onSignIn={() =>
        signInThen((ended) => ({ step: "sign-in", ended }), undefined)
      }
      onGrant={() =>
        signInThen((ended) => ({ step: "grant", ended }), [GIST_SCOPE])
      }
      onCancelSignIn={cancelSignIn}
      onCopy={copy}
      copyFailed={copyFailed}
    />
  );
};

export default ShareGist;
