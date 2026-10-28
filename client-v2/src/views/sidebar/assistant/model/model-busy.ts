/**
 * A turn the model turned away for load (a 429, from any backend). The panel
 * counts down and sends it again (Spec 08's AI-03) rather than showing an
 * error.
 */
export class ModelBusyError extends Error {
  /**
   * @param waitSeconds what the server asked to wait, if it said
   * @param message what the turn's failure says, so the words live in one
   * place (`run-turn`)
   * @param options the provider's failure, kept as `cause`
   */
  constructor(
    readonly waitSeconds: number | undefined,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ModelBusyError";
  }
}
