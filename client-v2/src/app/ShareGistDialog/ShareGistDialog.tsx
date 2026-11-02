import { useEffect, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";

import { isSignInFailure, PgSession } from "@/features/auth";
import { useRenderOnChange } from "@/hooks";
import { ShareGist } from "@/features/gist";
import { createLogger } from "@/shared/lib/logger";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { PgView } from "@/utils/view";
import { ModalFrame } from "@/widgets/overlays";
import { GithubMark } from "@/widgets/session-footer";

const log = createLogger("app:share-gist");

interface ShareGistDialogProps {
  name: string;
  readFiles: () => Promise<Record<string, string>>;
}

/** What the prompt shows for a sign-in that ended without a session */
const messageOf = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "Sign-in failed.";

/**
 * What a signed-out Share shows first (the `gist-sharing` spec, "Sign in to
 * share"): why sharing needs GitHub, and the sign-in. Signing in is a popup,
 * so the project stays as it is; the session it brings turns the dialog into
 * the share dialog, which sends nothing until its own button is pressed.
 *
 * The sign-in runs beside the frame's submit, not inside it: the popup cannot
 * say it was closed (`popup-channel`), so a submit that waited on it would
 * hold the dialog busy, with Cancel off, until the flow expires. Here Cancel
 * stays live, and closing the dialog while the sign-in waits cancels it.
 */
const SignInToShare = () => {
  useRenderOnChange(PgSession.onDidChange);
  const waiting = PgSession.signInState().status === "pending";
  const [failure, setFailure] = useState<string>();
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

  const signIn = () => {
    setFailure(undefined);
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
        if (mounted.current) setFailure(messageOf(error));
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
        text: waiting ? "Waiting for GitHub…" : "Sign in with GitHub",
        icon: <GithubMark className="size-4" />,
        onSubmit: signIn,
        noCloseOnSubmit: true,
        disabled: waiting,
      }}
    >
      <div className="flex max-w-md flex-col gap-3">
        <p className="text-body font-read text-muted-foreground">
          Your project goes to a gist on your GitHub account.
        </p>
        {failure && (
          <Callout variant="error">
            <TriangleAlert />
            <CalloutDescription>{failure}</CalloutDescription>
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
const ShareGistDialog = ({ name, readFiles }: ShareGistDialogProps) => {
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
    <ModalFrame name="share-gist" title={`Share ${name} as a gist`}>
      <ShareGist
        name={name}
        readFiles={readFiles}
        signedIn={signedIn}
        signIn={(options) => PgSession.signInWith({ scopes: options?.scopes })}
      />
    </ModalFrame>
  );
};

/** Open the share dialog; settles when it closes */
export const openShareGistDialog = (
  readFiles: () => Promise<Record<string, string>>,
  name: string
) =>
  PgView.setModal<unknown, ShareGistDialogProps>(ShareGistDialog, {
    name,
    readFiles,
  });
