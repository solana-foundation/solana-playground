import { Check, Copy, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { isSignInFailure, PgSession } from "@/features/auth";
import type {
  GistShareSource,
  ShareGistControl,
  SignInEnding,
} from "@/features/gist";
import {
  BaseShareGist,
  shareAction,
  shareTitle,
  signInFailureMessage,
  useShareGist,
} from "@/features/gist";
import { useRenderOnChange } from "@/hooks";
import { GithubMark } from "@/shared/lib/github-mark";
import { createLogger } from "@/shared/lib/logger";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { Spinner } from "@/shared/ui/spinner";
import { PgView } from "@/utils/view";
import { ModalFrame } from "@/widgets/overlays";

const log = createLogger("app:share-gist");

interface ShareGistDialogProps {
  name: string;
  readFiles: () => Promise<Record<string, string>>;
  /** Where the dialog was opened, for the share's telemetry */
  source: GistShareSource;
}

/**
 * Whether a sign-in ended because the user cancelled it: by a Cancel here,
 * or on GitHub. `PgSession` holds why its last sign-in failed
 */
const isCancel = (error: unknown) => {
  const state = PgSession.signInState();
  return (
    isSignInFailure(error) &&
    state.status === "failed" &&
    state.reason === "cancelled"
  );
};

/**
 * Log why a sign-in ended without a session. `PgSession` holds why its last
 * sign-in failed. One the user ended (cancelled, a blocked popup, a timeout)
 * is theirs to see; one that could not start, or any other error, the team
 * hears of too.
 */
const logSignInEnding = (error: unknown) => {
  const state = PgSession.signInState();
  const isUserEnded =
    isSignInFailure(error) &&
    state.status === "failed" &&
    state.reason !== "request-failed";
  if (isUserEnded) {
    // `auth_sign_in_failed` has counted it with its reason
    log.info("sign-in to share ended without a session", {
      context: { reason: state.reason },
    });
  } else {
    log.error(error, { report: true, context: { item: "sign-in" } });
  }
};

/** The prompt's one button: sign in, cancel its own wait, or wait on another's */
const buttonText = (waiting: boolean, cancellable: boolean) => {
  if (cancellable) return "Cancel sign-in";
  if (waiting) return "Waiting for GitHub…";
  return "Sign in with GitHub";
};

/** The prompt's icon: GitHub's mark, none on the cancel, a spinner on another's wait */
const signInIcon = (waiting: boolean, cancellable: boolean) => {
  if (cancellable) return undefined;
  // Hidden from the button's name, which the label says already
  if (waiting) return <Spinner aria-hidden="true" />;
  return <GithubMark className="size-4" />;
};

/**
 * What a signed-out Share shows first (the `gist-sharing` spec, "Sign in to
 * share"): why sharing needs GitHub, and the sign-in. Signing in is a popup,
 * so the project stays as it is; the session it brings turns the dialog into
 * the share dialog, which sends nothing until its own button is pressed.
 *
 * The sign-in runs beside the frame's submit, not inside it: the popup cannot
 * say it was closed (`popup-channel`), so a submit that waited on it would
 * hold the dialog busy, with Cancel off, until the flow expires. While it
 * waits the submit reads "Cancel sign-in" and stops it, keeping the prompt
 * open, as the prototype's own sign-in control does. The footer has no Cancel
 * then; the header's Close closes the dialog and cancels the sign-in too.
 */
const SignInToShare = () => {
  useRenderOnChange(PgSession.onDidChange);
  const waiting = PgSession.signInState().status === "pending";
  // A sign-in the user cancelled is said quietly; a real failure in red
  const [ended, setEnded] = useState<SignInEnding>();
  // The sign-in settles after a Cancel has closed the dialog
  const mounted = useRef(true);
  // Whether the sign-in under way is this prompt's: one started from the
  // account menu is the user's to end there, not by closing Share
  const ownSignIn = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Closed while its popup is still open: the user gave up on sharing.
      // Unmounted by a session that arrived, nothing is left to cancel
      if (ownSignIn.current && !PgSession.get()) PgSession.cancelSignIn();
    };
  }, []);

  // A sign-in from the account menu ends with the session arriving under this
  // dialog, which must keep the project it is sharing. It stays claimed if the
  // dialog closes first: the user stays on the open project, which loses nothing
  useEffect(() => {
    if (waiting) PgSession.claimPendingSignIn("share");
  }, [waiting]);

  // Only this prompt's own sign-in is its to cancel; one from the account
  // menu just waits here, as it did before the prompt could cancel
  const cancellable = waiting && ownSignIn.current;

  const signIn = () => {
    // While its own popup is open the button is the cancel
    if (cancellable) {
      PgSession.cancelSignIn();
      return;
    }
    setEnded(undefined);
    ownSignIn.current = true;
    PgSession.signInFor("share")([])
      .catch((error: unknown) => {
        logSignInEnding(error);
        if (mounted.current) {
          setEnded({
            kind: isCancel(error) ? "cancelled" : "failed",
            message: signInFailureMessage(error),
          });
        }
      })
      .finally(() => {
        ownSignIn.current = false;
      });
  };

  return (
    <ModalFrame
      name="share-gist-sign-in"
      title="Sign in to share"
      size="narrow"
      buttonProps={{
        text: buttonText(waiting, cancellable),
        icon: signInIcon(waiting, cancellable),
        onSubmit: signIn,
        noCloseOnSubmit: true,
        disabled: waiting && !cancellable,
        // One cancel while the popup waits, Cancel sign-in; the head's Close
        // still closes the prompt and cancels it, as the share dialog's does
        noCancel: waiting && cancellable,
        // The same one action as every other step of Share
        variant: "brand",
      }}
    >
      <div className="flex flex-col gap-3">
        <p className="text-body font-read text-muted-foreground">
          Your project goes to a gist on your GitHub account.
        </p>
        {ended?.kind === "cancelled" && (
          <p
            role="status"
            className="text-body font-read text-muted-foreground"
          >
            {ended.message}
          </p>
        )}
        {ended?.kind === "failed" && (
          <Callout variant="error">
            <TriangleAlert />
            <CalloutDescription>{ended.message}</CalloutDescription>
          </Callout>
        )}
      </div>
    </ModalFrame>
  );
};

const onShareError = reportButtonFailure("share the project");

/**
 * The share dialog's frame: its heading and its one action follow the step
 * (`shareTitle`, `shareAction`), the body is the gist feature's.
 *
 * A sign-in or a grant runs beside the frame's submit, not inside it, as the
 * prompt's does: a submit that waited on the popup would hold the dialog
 * busy, with Cancel off, while the footer offers "Cancel sign-in".
 */
const ShareFrame = ({ body, run }: ShareGistControl) => {
  const action = shareAction(body);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    if (!(await run.copy())) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1400);
  };

  const submits: Record<Exclude<typeof action.run, "close">, () => unknown> = {
    create: () => run.create().catch(onShareError),
    "sign-in": () => void run["sign-in"]().catch(onShareError),
    grant: () => void run.grant().catch(onShareError),
    "cancel-sign-in": run["cancel-sign-in"],
    copy,
  };
  // Without a submit of its own, the frame's button closes the dialog
  // (Close), and that is no call to action: outlined, not the brand one
  const shouldClose = action.run === "close";
  const onSubmit = action.run === "close" ? undefined : submits[action.run];

  let icon;
  if (action.busy) icon = <Spinner aria-hidden="true" />;
  else if (action.github) icon = <GithubMark className="size-4" />;
  else if (action.run === "copy") icon = copied ? <Check /> : <Copy />;

  return (
    <ModalFrame
      name="share-gist"
      title={shareTitle(body)}
      // Created opens with nothing ringed: focus on the link would select it
      // and scroll it to its end, hiding where the address starts
      openFocus={body.state.step === "created" ? "dialog" : undefined}
      buttonProps={{
        text: action.run === "copy" && copied ? "Copied" : action.label,
        icon,
        onSubmit,
        noCloseOnSubmit: !shouldClose,
        // The gist exists by then: Cancel would read as undoing the share.
        // While GitHub's popup waits, Cancel beside Cancel sign-in reads as
        // two of the same; the head's Close is the way out then
        noCancel: action.run === "copy" || action.run === "cancel-sign-in",
        disabled: action.busy,
        variant: shouldClose ? "outline" : "brand",
      }}
    >
      <BaseShareGist {...body} githubMark={<GithubMark />} />
    </ModalFrame>
  );
};

/** The share dialog with its state connected */
const ConnectedShare = ({
  name,
  readFiles,
  source,
  signedIn,
}: ShareGistDialogProps & { signedIn: boolean }) => {
  const control = useShareGist(
    {
      signIn: (scopes) =>
        PgSession.signInFor("share")(scopes).then(
          () => "signed-in" as const,
          (error: unknown) => {
            logSignInEnding(error);
            if (isCancel(error)) return "cancelled" as const;
            throw error;
          }
        ),
      cancelSignIn: () => PgSession.cancelSignIn(),
      origin: window.location.origin,
    },
    { name, readFiles, source, signedIn }
  );
  return <ShareFrame {...control} />;
};

/**
 * Share a project as a gist: the gist feature's body in a dialog of
 * `PgView`'s stack, with sign-in from the auth feature. It lives in the app
 * layer because the two features may not import each other. Signed out, the
 * sign-in prompt stands in its place until a session arrives.
 */
const ShareGistDialog = ({ name, readFiles, source }: ShareGistDialogProps) => {
  // The first session read may still be on its way when the dialog opens,
  // and a sign-in, from the prompt or elsewhere, moves the dialog on
  useRenderOnChange(PgSession.onDidChange);
  const signedIn = !!PgSession.get();
  // Once sharing shows, a session that ends is mended inside it (the share
  // body offers to sign in again), never by going back to the prompt, which
  // would drop the share under way
  const shared = useRef(signedIn);
  if (signedIn) shared.current = true;
  if (!shared.current) return <SignInToShare />;
  return (
    <ConnectedShare
      name={name}
      readFiles={readFiles}
      source={source}
      signedIn={signedIn}
    />
  );
};

/**
 * Open the share dialog; settles when it closes. `source`, where it was
 * opened from, is fixed per call site and comes first:
 * `openShareGistDialogFor("header")(readFiles, name)`.
 */
export const openShareGistDialogFor =
  (source: GistShareSource) =>
  (readFiles: () => Promise<Record<string, string>>, name: string) =>
    PgView.setModal<unknown, ShareGistDialogProps>(ShareGistDialog, {
      name,
      readFiles,
      source,
    });
