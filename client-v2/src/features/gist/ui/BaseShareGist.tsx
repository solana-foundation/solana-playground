import {
  ChevronDown,
  CircleCheck,
  ExternalLink,
  Files,
  InfoIcon,
  Lock,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { cn } from "@/shared/lib/utils";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { Input } from "@/shared/ui/input";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";

import { MANIFEST_NAME } from "../lib/format";
import type { ExportFailure } from "../model/export";
import type { GistVisibility } from "../model/telemetry";

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

/** What goes to the gist: shown folded to a count and a size */
export interface ShareFiles {
  paths: string[];
  bytes: number;
}

/** The dialog's one action for a step, drawn in its footer */
export interface ShareAction {
  label: string;
  run: "create" | "sign-in" | "grant" | "cancel-sign-in" | "copy" | "close";
  busy?: boolean;
  /** The action opens GitHub, so it carries GitHub's mark */
  github?: boolean;
}

export interface BaseShareGistProps {
  /** The project's name */
  name: string;
  state: ShareStep;
  /** The visibility chosen for the gist */
  visibility: GistVisibility;
  onVisibilityChange: (visibility: GistVisibility) => void;
  /** Whether an export request runs, which locks the visibility */
  busy: boolean;
  /** `undefined` while the project is still being read */
  files: ShareFiles | undefined;
  /** Whether the last copy was refused by the clipboard */
  copyFailed: boolean;
  /** GitHub's mark, for the step GitHub asks; the caller's, as auth's is */
  githubMark: ReactNode;
}

/**
 * A refused gist (422) fails the same on every retry, and a project over the
 * limits needs to get smaller first, so neither offers a retry.
 * `request-failed` also covers a gist GitHub may have created (a 201 whose
 * body did not parse, a drop after GitHub accepted), so it sends the user to
 * their gists before a retry that could publish a second copy.
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

/** A failure that is GitHub holding back, not something wrong: a warning */
const WARNS: ShareFailure[] = ["rate-limited"];

const RETRY: Record<ShareFailure, ShareAction> = {
  "too-large": { label: "Close", run: "close" },
  rejected: { label: "Close", run: "close" },
  // A revoked grant is mended by signing in again, not by the same request
  "github-unauthorized": {
    label: "Sign in with GitHub",
    run: "sign-in",
    github: true,
  },
  "scope-not-granted": {
    label: "Allow gists on GitHub",
    run: "grant",
    github: true,
  },
  "rate-limited": { label: "Try again", run: "create" },
  "request-failed": { label: "Try again", run: "create" },
};

/**
 * The footer's action for a step. While a popup waits on GitHub it is the
 * cancel, as the sign-in prompt's is; a refused gist and one over the limits
 * offer no retry, which would fail the same: Close is all they have.
 */
export const shareAction = ({
  state,
  visibility,
  busy,
}: Pick<BaseShareGistProps, "state" | "visibility" | "busy">): ShareAction => {
  if (busy) return { label: "Creating gist…", run: "create", busy: true };
  switch (state.step) {
    case "ready":
      return { label: `Create ${visibility} gist`, run: "create" };
    case "sign-in":
      return { label: "Sign in with GitHub", run: "sign-in", github: true };
    case "grant":
      return { label: "Allow gists on GitHub", run: "grant", github: true };
    case "waiting":
      return { label: "Cancel sign-in", run: "cancel-sign-in" };
    case "created":
      // The link is what the share was for, so copying it is the primary,
      // in the footer: a phone pins it at the thumb, full width
      return { label: "Copy link", run: "copy" };
    case "failed":
      return RETRY[state.reason];
  }
};

/** The dialog's heading for a step */
export const shareTitle = ({
  name,
  state,
  visibility,
}: Pick<BaseShareGistProps, "name" | "state" | "visibility">) =>
  state.step === "created"
    ? `Shared as a ${visibility} gist`
    : `Share ${name} as a gist`;

const sizeLabel = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const VISIBILITY: Record<GistVisibility, { title: string; detail: string }> = {
  secret: {
    title: "Secret",
    detail:
      "Only people you send the link to. Not listed on your GitHub profile.",
  },
  public: {
    title: "Public",
    detail: "Listed on your GitHub profile, anyone can find it.",
  },
};

/** Secret or Public, as two cards, Secret first; locked while a request runs */
const WhoCanOpen = ({
  visibility,
  onChange,
  locked,
}: {
  visibility: GistVisibility;
  onChange: (visibility: GistVisibility) => void;
  locked: boolean;
}) => (
  <div className="flex flex-col gap-2">
    <p
      id="share-gist-visibility-label"
      className="text-caption font-act text-foreground"
    >
      Who can open it
    </p>
    <RadioGroup
      aria-labelledby="share-gist-visibility-label"
      className="grid-cols-1 sm:grid-cols-2"
      value={visibility}
      onValueChange={(value) => onChange(value as GistVisibility)}
      disabled={locked}
    >
      {(Object.keys(VISIBILITY) as GistVisibility[]).map((id) => (
        <label
          key={id}
          className={cn(
            "flex cursor-pointer gap-2.5 rounded-xl border border-border p-3 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/10",
            locked && "cursor-default opacity-60"
          )}
        >
          {/* Named by its title alone, the detail its description */}
          <RadioGroupItem
            id={`share-gist-visibility-${id}`}
            value={id}
            className="mt-0.5"
            aria-labelledby={`share-gist-visibility-${id}-title`}
            aria-describedby={`share-gist-visibility-${id}-detail`}
          />
          <span className="flex flex-col gap-0.5">
            <span
              id={`share-gist-visibility-${id}-title`}
              className="text-body font-act text-foreground"
            >
              {VISIBILITY[id].title}
            </span>
            <span
              id={`share-gist-visibility-${id}-detail`}
              className="text-body font-read text-muted-foreground"
            >
              {VISIBILITY[id].detail}
            </span>
          </span>
        </label>
      ))}
    </RadioGroup>
  </div>
);

/**
 * What goes to the gist, folded to a count, and what stays: the row is a
 * control, at controls' size; what stays is a note under it, at the size of
 * supporting text, so it holds one line
 */
const WhatGoes = ({ files }: { files: ShareFiles | undefined }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border">
      <button
        type="button"
        // The ring follows the box's top corners, which clip it otherwise
        className="flex items-center gap-2.5 rounded-t-xl px-3 py-2.5 text-left text-control font-read text-foreground outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset disabled:cursor-default"
        aria-expanded={open}
        disabled={!files}
        onClick={() => setOpen((o) => !o)}
      >
        <Files className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="flex-1">
          {files
            ? `${files.paths.length} files go to the gist`
            : "Reading the project…"}
        </span>
        {files && (
          <span className="text-body font-read text-muted-foreground">
            {sizeLabel(files.bytes)}
          </span>
        )}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {/* The paths sit under the row's words, past its icon (12 + 16 + 10),
          and the manifest is named, so no file on GitHub comes unannounced */}
      {open && files && (
        <ul className="flex max-h-40 list-none flex-col gap-1 overflow-y-auto border-t border-border py-2.5 pr-3 pl-[2.375rem] text-caption">
          {files.paths.map((path) => (
            <li key={path} className="font-mono text-muted-foreground">
              {path}
            </li>
          ))}
          <li className="mt-1 font-read text-muted-foreground">
            plus <span className="font-mono">{MANIFEST_NAME}</span>, so
            Playground can open the gist again
          </li>
        </ul>
      )}
      <p className="flex items-center gap-2.5 border-t border-border px-3 py-2.5 text-caption font-read text-muted-foreground">
        <Lock className="size-4 shrink-0" aria-hidden="true" />
        Stays in this browser: the program keypair and workspace settings
      </p>
    </div>
  );
};

/** The created gist: the Playground link to copy, the gist itself quietly */
const Created = ({
  name,
  link,
  url,
  visibility,
  copyFailed,
}: {
  name: string;
  link: string;
  url: string;
  visibility: GistVisibility;
  copyFailed: boolean;
}) => (
  <div className="flex flex-col gap-4" data-testid="share-gist-created">
    <div className="flex gap-3">
      <CircleCheck
        className="mt-0.5 size-5 shrink-0 text-success"
        aria-hidden="true"
      />
      <p className="flex flex-col gap-0.5">
        <span className="text-body font-act text-foreground">
          {name} opens in Playground from this link
        </span>
        <span className="text-body font-read text-muted-foreground">
          {visibility === "secret"
            ? "Anyone with this link can open it. It isn't on your GitHub profile."
            : "It's on your GitHub profile. Anyone with this link can open it."}
        </span>
      </p>
    </div>
    {/* The whole width, so the address shows from its start; a tap selects
        it for a copy by hand, the footer's Copy link does it in one press */}
    <Input
      readOnly
      aria-label="Playground link"
      className="w-full font-mono"
      value={link}
      onFocus={(event) => event.currentTarget.select()}
    />
    {copyFailed && (
      <Callout variant="error">
        <TriangleAlert />
        <CalloutDescription>
          Could not copy the link. Select it above and copy it by hand.
        </CalloutDescription>
      </Callout>
    )}
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 self-start text-caption font-read text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      Open the gist on GitHub
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  </div>
);

/**
 * The share dialog's body: who can open the gist, what goes into it, the step
 * GitHub asks once, and the Playground link once the gist is made. The frame
 * (title, Close and the one action, `shareAction`) is the caller's.
 */
const BaseShareGist = ({
  name,
  state,
  visibility,
  onVisibilityChange,
  busy,
  files,
  copyFailed,
  githubMark,
}: BaseShareGistProps) => {
  if (state.step === "created") {
    return (
      <Created
        name={name}
        link={state.link}
        url={state.url}
        visibility={visibility}
        copyFailed={copyFailed}
      />
    );
  }

  // The permission is one more step, so it reads as a step, not a paragraph
  const granting =
    (state.step === "grant" && !state.ended) ||
    (state.step === "waiting" && state.for === "grant");
  if (granting) {
    return (
      <div className="flex gap-3" data-testid="share-gist">
        {/* 18, a step under the 20 outline icons: a filled mark reads
            larger at one size. Centred on the heading's 24 px line */}
        <span className="mt-[3px] shrink-0 text-foreground [&_svg]:size-[18px]">
          {githubMark}
        </span>
        <p className="flex flex-col gap-0.5">
          <span className="text-body font-act text-foreground">
            One more step on GitHub
          </span>
          <span className="text-body font-read text-muted-foreground">
            GitHub asks you once to let Playground create gists on your account.
            Then the {visibility} gist is created right away.
          </span>
        </p>
      </div>
    );
  }

  let problem: { text: string; warn: boolean } | undefined;
  let notice: string | undefined;
  if (state.step === "failed") {
    problem = {
      text: FAILURE[state.reason](name),
      warn: WARNS.includes(state.reason),
    };
  } else if (state.step === "sign-in" || state.step === "grant") {
    if (state.ended?.kind === "cancelled") notice = state.ended.message;
    else if (state.ended) problem = { text: state.ended.message, warn: false };
  }
  // A session that ended is the user's to mend, not a fault: a warning
  const signInStep = state.step === "sign-in";

  return (
    <div className="flex flex-col gap-4" data-testid="share-gist">
      <WhoCanOpen
        visibility={visibility}
        onChange={onVisibilityChange}
        locked={busy || state.step === "waiting"}
      />
      <WhatGoes files={files} />
      {notice && (
        <p role="status" className="text-body font-read text-muted-foreground">
          {notice}
        </p>
      )}
      {problem && (
        <Callout variant={problem.warn || signInStep ? "warning" : "error"}>
          {signInStep ? <InfoIcon /> : <TriangleAlert />}
          <CalloutDescription>
            {problem.text}
            {state.step === "failed" && state.reason === "request-failed" && (
              <>
                {" "}
                <a
                  href="https://gist.github.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-act underline underline-offset-4"
                >
                  Your gists
                </a>
              </>
            )}
          </CalloutDescription>
        </Callout>
      )}
    </div>
  );
};

export default BaseShareGist;
