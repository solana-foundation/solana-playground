import { ExternalLink, InfoIcon, TriangleAlert } from "lucide-react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { CopyButton } from "@/shared/ui/copy-button";
import { Input } from "@/shared/ui/input";
import type { ExportFailure } from "../model/export";

/** Why a share ended without a gist, as the dialog words it */
export type ShareFailure = ExportFailure | "scope-not-granted";

/**
 * Where a share stands. `sign-in` and `grant` carry the reason the last try
 * of that step failed, if it did; a press from either is a retry.
 */
export type ShareStep =
  | { step: "ready" }
  | { step: "sign-in"; error?: string }
  | { step: "grant"; error?: string }
  | { step: "created"; url: string }
  | { step: "failed"; reason: ShareFailure };

export interface BaseShareGistProps {
  /** The project's name */
  name: string;
  state: ShareStep;
  /** Create the gist; settles when the attempt has an answer */
  onCreate: () => Promise<unknown>;
  /** Sign in with GitHub, then create the gist */
  onSignIn: () => Promise<unknown>;
  /** Allow gists on GitHub, then create the gist */
  onGrant: () => Promise<unknown>;
}

const FAILURE: Record<ShareFailure, (name: string) => string> = {
  "too-large": (name) =>
    `${name} is too large to share as a gist: over 4 MB or 300 files.`,
  "github-unauthorized": () =>
    "GitHub no longer accepts this sign-in. Sign in again to share.",
  "rate-limited": () =>
    "GitHub is limiting requests right now. Try again in a few minutes.",
  rejected: () => "GitHub refused the gist.",
  "request-failed": () => "Could not reach GitHub. Try again.",
  "scope-not-granted": () =>
    "GitHub did not grant gist access, so the gist was not created.",
};

/** The one action each step offers, with its label */
const ACTION: Record<
  Exclude<ShareStep["step"], "created">,
  { label: string; run: "create" | "sign-in" | "grant" }
> = {
  ready: { label: "Create public gist", run: "create" },
  "sign-in": { label: "Sign in with GitHub to share", run: "sign-in" },
  grant: { label: "Allow gists on GitHub", run: "grant" },
  failed: { label: "Try again", run: "create" },
};

const onError = reportButtonFailure("share the project");

/**
 * The share dialog's body: what will be published, the one action the step
 * offers, and the gist once it is made. The frame (title, Close) is the
 * caller's.
 */
const BaseShareGist = ({
  name,
  state,
  onCreate,
  onSignIn,
  onGrant,
}: BaseShareGistProps) => {
  if (state.step === "created") {
    return (
      <div
        className="flex max-w-md flex-col gap-3"
        data-testid="share-gist-created"
      >
        <p className="text-body font-read text-foreground">
          {name} is on GitHub as a public gist.
        </p>
        <div className="flex gap-2">
          <Input
            readOnly
            aria-label="Gist URL"
            className="min-w-0 flex-1"
            value={state.url}
            onFocus={(event) => event.currentTarget.select()}
          />
          <CopyButton
            value={state.url}
            label="Copy gist URL"
            onError={onError}
          />
        </div>
        <a
          href={state.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 self-start text-control font-act text-primary underline-offset-4 hover:underline"
        >
          Open on GitHub
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </div>
    );
  }

  let action = ACTION[state.step];
  // A revoked grant is mended by signing in again, not by the same request
  if (state.step === "failed" && state.reason === "github-unauthorized") {
    action = { label: "Sign in with GitHub again", run: "sign-in" };
  }
  const run = { create: onCreate, "sign-in": onSignIn, grant: onGrant }[
    action.run
  ];

  let problem: string | undefined;
  if (state.step === "failed") problem = FAILURE[state.reason](name);
  else if (state.step === "sign-in" || state.step === "grant") {
    problem = state.error;
  }

  return (
    <div className="flex max-w-md flex-col gap-3" data-testid="share-gist">
      <Callout variant="info">
        <InfoIcon />
        <CalloutDescription>
          The gist is public: anyone with the link can read the code. The
          program keypair and the project&apos;s workspace settings stay in this
          browser.
        </CalloutDescription>
      </Callout>

      {state.step === "grant" && (
        <p className="text-body font-read text-muted-foreground">
          GitHub needs your permission for Playground to create gists on your
          account. It asks once.
        </p>
      )}

      {problem && (
        <Callout variant="error">
          <TriangleAlert />
          <CalloutDescription>{problem}</CalloutDescription>
        </Callout>
      )}

      <AsyncButton
        type="button"
        className="self-start"
        onClick={run}
        onError={onError}
      >
        {action.label}
      </AsyncButton>
    </div>
  );
};

export default BaseShareGist;
