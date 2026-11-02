import { TurnFailure } from "./types";

/**
 * A turn the model turned away for load (a 429, from any backend, that is not
 * our backend's daily cap). The panel
 * counts down and sends it again (Spec 08's AI-03) rather than showing an
 * error.
 */
export class ModelBusyError extends TurnFailure {
  /**
   * @param waitSeconds what the server asked to wait, if it said
   * @param message what the turn's failure says, so the words live in one
   * place (`run-turn`)
   * @param options the HTTP status, and the provider's failure as `cause`
   */
  constructor(
    readonly waitSeconds: number | undefined,
    message: string,
    options: { status?: number; cause?: unknown } = {}
  ) {
    super(message, { reason: "provider", ...options });
    this.name = "ModelBusyError";
  }
}
