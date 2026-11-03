import { useEffect, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";

import { isSignInFailure, PgSession } from "@/features/auth";
import { useRenderOnChange } from "@/hooks";
import { ShareGist } from "@/features/gist";
import type { GistShareSource, SignInEnding } from "@/features/gist";
import { createLogger } from "@/shared/lib/logger";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { PgView } from "@/utils/view";
import { ModalFrame } from "@/widgets/overlays";
import { GithubMark } from "@/widgets/session-footer";

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

/** What the prompt shows for a sign-in that ended without a session */
const messageOf = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "Sign-in failed.";

/** The prompt's one button: sign in, cancel its own wait, or wait on another's */
const buttonText = (waiting: boolean, cancellable: boolean) => {
  if (cancellable) return "Cancel sign-in";
  if (waiting) return "Waiting for GitHub…";
  return "Sign in with GitHub";
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
 * open, as the prototype's own sign-in control does; the frame's Cancel
 * closes the dialog and cancels it too.
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
    PgSession.signIn()
      .catch((error: unknown) => {
        // `PgSession` holds why its last sign-in failed. One the user ended
        // (cancelled, a blocked popup, a timeout) is theirs to see; one that
        // could not start, or any other error, the team hears of too
        const state = PgSession.signInState();
        const userEnded =
          isSignInFailure(error) &&
          state.status === "failed" &&
          state.reason !== "request-failed";
        if (userEnded) {
          // `auth_sign_in_failed` has counted it with its reason
          log.info("sign-in to share ended without a session", {
            context: { reason: state.reason },
          });
        } else {
          log.error(error, { report: true, context: { item: "sign-in" } });
        }
        if (mounted.current) {
          setEnded({
            kind: isCancel(error) ? "cancelled" : "failed",
            message: messageOf(error),
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
      buttonProps={{
        text: buttonText(waiting, cancellable),
        icon: waiting ? undefined : <GithubMark className="size-4" />,
        onSubmit: signIn,
        noCloseOnSubmit: true,
        disabled: waiting && !cancellable,
      }}
    >
      <div className="flex max-w-md flex-col gap-3">
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
    <ModalFrame name="share-gist" title="Share to GitHub">
      <ShareGist
        name={name}
        readFiles={readFiles}
        source={source}
        signedIn={signedIn}
        signIn={(options) =>
          PgSession.signInWith({ scopes: options?.scopes }).then(
            () => "signed-in" as const,
            (error: unknown) => {
              if (isCancel(error)) return "cancelled" as const;
              throw error;
            }
          )
        }
        cancelSignIn={() => PgSession.cancelSignIn()}
      />
    </ModalFrame>
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
