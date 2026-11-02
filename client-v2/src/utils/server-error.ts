/** `PgServerError.body` when the refusal's body could not be read */
export const UNREADABLE_BODY = "<unreadable response body>";

/**
 * A request to the build server that failed. `status` is the HTTP status of
 * a refused request and `body` what the server answered; with no answer
 * (offline, CORS, abort), `status` is `null` and `body` is the network
 * error's message, and `cause` the error itself. Callers branch on `status`
 * and `body` (`downloadFailure` tells a dropped build from other refusals).
 */
export class PgServerError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    readonly body: string,
    options?: { cause?: unknown }
  ) {
    super(`Server request failed (${url}): ${body}`, options);
    this.name = "PgServerError";
  }

  /**
   * Whether the server replied at all. `false` is Spec 08's BUILD-04, "did
   * not answer", which `buildFailureOf` in `views/flow/state/stage.ts` reads
   * by shape.
   */
  get answered(): boolean {
    return this.status !== null;
  }
}
