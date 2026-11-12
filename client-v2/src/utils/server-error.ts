/** `PgServerError.body` when the refusal's body could not be read */
export const UNREADABLE_BODY = "<unreadable response body>";

/** What `PgServerError` is built from */
interface PgServerErrorInit {
  url: string;
  /** The HTTP status, `undefined` when the server did not answer */
  status: number | undefined;
  body: string;
  cause?: unknown;
}

/**
 * A request to the build server that failed. `status` is the HTTP status of
 * a refused request and `body` what the server answered; with no answer
 * (offline, CORS, abort), `status` is `undefined` and `body` is the network
 * error's message, and `cause` the error itself. Callers branch on `status`
 * and `body` (`downloadFailure` tells a dropped build from other refusals).
 */
export class PgServerError extends Error {
  readonly url: string;
  readonly status: number | undefined;
  readonly body: string;

  constructor(init: PgServerErrorInit) {
    super(
      `Server request failed (${init.url}): ${init.body}`,
      "cause" in init ? { cause: init.cause } : undefined
    );
    this.name = "PgServerError";
    this.url = init.url;
    this.status = init.status;
    this.body = init.body;
  }

  /**
   * Whether the server replied at all. `false` is Spec 08's BUILD-04, "did
   * not answer", which `buildFailureOf` in `views/flow/state/stage.ts` reads
   * by shape.
   */
  get answered(): boolean {
    return this.status !== undefined;
  }
}
