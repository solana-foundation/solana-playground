import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription, CalloutTitle } from "@/shared/ui/callout";

import type { AiOffReason } from "../model/ai-off";

/**
 * What each reason says, and the action it leads with: the designers' Spec 08
 * (AI-01) and Spec 04 ("Model unavailable") give the no-key and unreachable
 * titles; the signed-out title is ours, as no spec gives one. The key button follows on every reason; a
 * reason whose first action is the key offers Try again after it.
 */
const REASONS: Record<
  AiOffReason,
  { title: string; text: string; action?: "sign-in" | "retry" }
> = {
  "no-key": {
    title: "The assistant has no model",
    text: "The hosted model is not available. Add your own key to use the assistant.",
  },
  "signed-out": {
    title: "Sign in to use the assistant",
    text: "Sign in with GitHub to use the hosted model, or add a key of your own.",
    action: "sign-in",
  },
  unreachable: {
    title: "Model not answering",
    text: "The assistant can't reach its model. Try again in a minute.",
    action: "retry",
  },
};

/** Send's tooltip while the row stands, by reason */
export const AI_OFF_SEND_BLOCKED: Record<AiOffReason, string> = {
  "no-key": "Connect a model to send",
  "signed-out": "Sign in to send",
  unreachable: "Can't reach the model",
};

export interface BaseAiOffRowProps {
  reason: AiOffReason;
  /** A requested prompt waits in the composer */
  promptWaiting: boolean;
  /** Why the last sign-in from the row failed, if it did */
  signInError?: string;
  /** A sign-in is under way, so a second press would only join it */
  signingIn: boolean;
  /** A Try again is under way, so a second press would only join it */
  retrying: boolean;
  onAddKey(): void;
  onSignIn(): void;
  onRetry(): void;
}

/**
 * The composer's top row while no model can answer this user: a title, why,
 * and the ways in. The designers' first-run spec keeps the composer on screen and
 * puts the reason in its top row, so this sits above the composer, never in
 * its place.
 */
export function BaseAiOffRow({
  reason,
  promptWaiting,
  signInError,
  signingIn,
  retrying,
  onAddKey,
  onSignIn,
  onRetry,
}: BaseAiOffRowProps) {
  const { title, text, action } = REASONS[reason];
  const retryButton = (
    <Button
      size="sm"
      variant={action === "retry" ? "default" : "outline"}
      onClick={onRetry}
      disabled={retrying}
    >
      Try again
    </Button>
  );
  return (
    <Callout id="assistant-ai-off" variant="info" role="status">
      <CalloutTitle>{title}</CalloutTitle>
      <CalloutDescription>
        {text}
        {promptWaiting && " Your prompt is waiting in the composer."}
        {action === "sign-in" && signInError && (
          <span className="block">{signInError}</span>
        )}
      </CalloutDescription>
      <div className="mt-2 flex flex-wrap gap-2">
        {action === "sign-in" && (
          <Button size="sm" onClick={onSignIn} disabled={signingIn}>
            Sign in with GitHub
          </Button>
        )}
        {action === "retry" && retryButton}
        <Button
          size="sm"
          variant={action === undefined ? "default" : "outline"}
          onClick={onAddKey}
        >
          Add an API key
        </Button>
        {action === undefined && retryButton}
      </div>
    </Callout>
  );
}
