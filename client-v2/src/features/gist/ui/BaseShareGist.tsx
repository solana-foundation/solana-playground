import { ExternalLink, TriangleAlert } from "lucide-react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { HelpTip } from "@/shared/ui/help-tip";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import type { ExportFailure } from "../model/export";
import type { GistCopiedLink, GistVisibility } from "../model/telemetry";

/** Why a share ended without a gist, as the dialog words it */
export type ShareFailure = ExportFailure | "scope-not-granted";

/**
 * How the last try of a sign-in or a grant ended: a failure, said as an
 * error, or the user's own cancel, said quietly
 */
export type SignInEnding =
  | { kind: "failed"; message: string }
  | { kind: "cancelled"; message: string };

/**
 * Where a share stands. `sign-in` and `grant` carry how the last try of that
 * step ended, if it did; a press from either is a retry. `waiting` is a
 * sign-in or a grant whose popup is open on GitHub.
 */
export type ShareStep =
  | { step: "ready" }
  | { step: "sign-in"; ended?: SignInEnding }
  | { step: "grant"; ended?: SignInEnding }
  | { step: "waiting"; for: "sign-in" | "grant" }
  | { step: "created"; url: string; link: string }
  | { step: "failed"; reason: ShareFailure };

export interface BaseShareGistProps {
  /** The project's name */
  name: string;
  state: ShareStep;
  /** The visibility chosen for the gist */
  visibility: GistVisibility;
  onVisibilityChange: (visibility: GistVisibility) => void;
  /** Whether an export request runs, which locks the visibility */
  busy: boolean;
  /** Create the gist; settles when the attempt has an answer */
  onCreate: () => Promise<unknown>;
  /** Sign in with GitHub, then create the gist */
  onSignIn: () => Promise<unknown>;
  /** Allow gists on GitHub, then create the gist */
  onGrant: () => Promise<unknown>;
  /** Stop the sign-in or grant the `waiting` step waits on */
  onCancelSignIn: () => void;
  /** Put one of the shared state's links on the clipboard */
  onCopy: (link: GistCopiedLink) => Promise<unknown>;
  /** Whether the last copy was refused by the clipboard */
  copyFailed: boolean;
}

/**
 * A refused gist (422) fails the same on every retry, so it offers none.
 * `request-failed` also covers a gist GitHub may have created (a 201 whose
 * body did not parse, a drop after GitHub accepted), so its text sends the
 * user to their gists before a retry that could publish a second copy.
 */
const FAILURE: Record<ShareFailure, (name: string) => string> = {
  "too-large": (name) =>
    `${name} is too large to share as a gist: over 4 MB or 300 files.`,
  "github-unauthorized": () =>
    "GitHub no longer accepts this sign-in. Sign in again to share.",
  "rate-limited": () =>
    "GitHub is limiting requests from this browser. Try again in a few minutes.",
  rejected: () => "GitHub refused the gist. Nothing was published.",
  "request-failed": () =>
    "Could not export to GitHub. Check your gists on GitHub before you try again.",
  "scope-not-granted": () =>
    "GitHub did not grant gist access, so the gist was not created.",
};

/** The one action each step offers, with its label */
const ACTION: Record<
  Exclude<ShareStep["step"], "created" | "waiting">,
  { label: string; run: "create" | "sign-in" | "grant" }
> = {
  ready: { label: "Share to GitHub", run: "create" },
  "sign-in": { label: "Sign in with GitHub", run: "sign-in" },
  grant: { label: "Allow gists on GitHub", run: "grant" },
  failed: { label: "Try again", run: "create" },
};

const VISIBILITY: Array<{ value: GistVisibility; label: string }> = [
  { value: "secret", label: "Secret" },
  { value: "public", label: "Public" },
];

const onError = reportButtonFailure("share the project");
const onCopyError = reportButtonFailure("copy the link");

/** The Secret / Public choice, Secret first, locked while a request runs */
const VisibilityChoice = ({
  visibility,
  onChange,
  disabled,
}: {
  visibility: GistVisibility;
  onChange: (visibility: GistVisibility) => void;
  disabled: boolean;
}) => (
  <div className="flex flex-col gap-2">
    <div className="flex items-center gap-1.5">
      <span
        id="share-gist-visibility-label"
        className="text-control font-act text-foreground"
      >
        Visibility
      </span>
      <HelpTip label="About secret gists">
        Secret gists don&apos;t show on your profile. Anyone with the link can
        open them.
      </HelpTip>
    </div>
    <RadioGroup
      aria-labelledby="share-gist-visibility-label"
      className="flex gap-4"
      value={visibility}
      onValueChange={(value) => onChange(value as GistVisibility)}
      disabled={disabled}
    >
      {VISIBILITY.map(({ value, label }) => (
        <Label
          key={value}
          htmlFor={`share-gist-visibility-${value}`}
          className="font-read"
        >
          <RadioGroupItem id={`share-gist-visibility-${value}`} value={value} />
          {label}
        </Label>
      ))}
    </RadioGroup>
  </div>
);

/** The shared state: the Playground link to send, and the gist on GitHub */
const Shared = ({
  name,
  url,
  link,
  onCopy,
  copyFailed,
}: {
  name: string;
  url: string;
  link: string;
  onCopy: (link: GistCopiedLink) => Promise<unknown>;
  copyFailed: boolean;
}) => (
  <div
    className="flex max-w-md flex-col gap-3"
    data-testid="share-gist-created"
  >
    <p className="text-body font-act text-foreground">Shared</p>
    <div className="flex gap-2">
      <Input
        readOnly
        aria-label="Playground link"
        className="min-w-0 flex-1"
        value={link}
        onFocus={(event) => event.currentTarget.select()}
      />
      <AsyncButton
        type="button"
        onClick={() => onCopy("playground")}
        onError={onCopyError}
      >
        Copy Playground link
      </AsyncButton>
    </div>
    <p className="text-body font-read text-muted-foreground">
      Opens {name} in Solana Playground as a preview. Anyone with the link can
      see the code.
    </p>
    {copyFailed && (
      <Callout variant="error">
        <TriangleAlert />
        <CalloutDescription>
          Could not copy the link. Select it and copy it by hand.
        </CalloutDescription>
      </Callout>
    )}
    <div className="flex flex-wrap items-center gap-3">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-control font-act text-primary underline-offset-4 hover:underline"
      >
        Open on GitHub
        <ExternalLink className="size-3.5" aria-hidden="true" />
      </a>
      <AsyncButton
        type="button"
        variant="ghost"
        onClick={() => onCopy("github")}
        onError={onCopyError}
      >
        Copy GitHub link
      </AsyncButton>
    </div>
  </div>
);

/**
 * The share dialog's body: the visibility to share with, the one action the
 * step offers, and the Playground link once the gist is made. The frame
 * (title, Close) is the caller's.
 */
const BaseShareGist = ({
  name,
  state,
  visibility,
  onVisibilityChange,
  busy,
  onCreate,
  onSignIn,
  onGrant,
  onCancelSignIn,
  onCopy,
  copyFailed,
}: BaseShareGistProps) => {
  if (state.step === "created") {
    return (
      <Shared
        name={name}
        url={state.url}
        link={state.link}
        onCopy={onCopy}
        copyFailed={copyFailed}
      />
    );
  }

  let action: typeof ACTION[keyof typeof ACTION] | undefined =
    state.step === "waiting" ? undefined : ACTION[state.step];
  // A revoked grant is mended by signing in again, not by the same request
  if (state.step === "failed" && state.reason === "github-unauthorized") {
    action = { label: "Sign in with GitHub again", run: "sign-in" };
  }
  // A refused gist fails the same on every retry, so only Close is left
  if (state.step === "failed" && state.reason === "rejected") {
    action = undefined;
  }
  const run = action
    ? { create: onCreate, "sign-in": onSignIn, grant: onGrant }[action.run]
    : undefined;

  let problem: string | undefined;
  let notice: string | undefined;
  if (state.step === "failed") problem = FAILURE[state.reason](name);
  else if (state.step === "sign-in" || state.step === "grant") {
    if (state.ended?.kind === "cancelled") notice = state.ended.message;
    else problem = state.ended?.message;
  }

  const granting =
    state.step === "grant" ||
    (state.step === "waiting" && state.for === "grant");

  return (
    <div className="flex max-w-md flex-col gap-4" data-testid="share-gist">
      <VisibilityChoice
        visibility={visibility}
        onChange={onVisibilityChange}
        disabled={busy || state.step === "waiting"}
      />

      <p className="text-body font-read text-muted-foreground">
        The program keypair and the project&apos;s workspace settings stay in
        this browser.
      </p>

      {granting && (
        <p className="text-body font-read text-muted-foreground">
          GitHub needs your permission for Playground to create gists on your
          account. It asks once.
        </p>
      )}

      {notice && (
        <p role="status" className="text-body font-read text-muted-foreground">
          {notice}
        </p>
      )}

      {problem && (
        <Callout variant="error">
          <TriangleAlert />
          <CalloutDescription>{problem}</CalloutDescription>
        </Callout>
      )}

      {state.step === "waiting" && (
        // The popup cannot say it was closed (`popup-channel`), so the wait
        // ends here, as the prototype's sign-in control does: its own label
        // turns into the cancel
        <Button
          type="button"
          id="share-gist-cancel-sign-in"
          variant="outline"
          className="self-start"
          onClick={onCancelSignIn}
        >
          Cancel sign-in
        </Button>
      )}

      {action && run && (
        <AsyncButton
          type="button"
          className="self-start"
          onClick={run}
          onError={onError}
          loading={busy}
          loadingText={
            action.run === "create" ? "Sharing to GitHub…" : undefined
          }
        >
          {action.label}
        </AsyncButton>
      )}
    </div>
  );
};

export default BaseShareGist;
