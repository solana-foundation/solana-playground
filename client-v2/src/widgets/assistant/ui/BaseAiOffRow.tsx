import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import type { AiOffReason } from "../model/ai-off";

/** What each reason says, and whether it offers sign-in or a retry */
const REASONS: Record<
  AiOffReason,
  { text: string; action?: "sign-in" | "retry" }
> = {
  "no-key": {
    text: "The assistant needs a key of your own on this deployment.",
  },
  "signed-out": {
    text: "Sign in with GitHub to use the hosted model, or add a key of your own.",
    action: "sign-in",
  },
  unreachable: {
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
 * The composer's top row while no model can answer this user: why, and the
 * one way in. The designers' first-run spec keeps the composer on screen and
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
  const { text, action } = REASONS[reason];
  return (
    <Callout id="assistant-ai-off" variant="info" role="status">
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
        {action === "retry" && (
          <Button size="sm" onClick={onRetry} disabled={retrying}>
            Try again
          </Button>
        )}
        <Button
          size="sm"
          variant={action === undefined ? "default" : "outline"}
          onClick={onAddKey}
        >
          Add a key
        </Button>
      </div>
    </Callout>
  );
}
