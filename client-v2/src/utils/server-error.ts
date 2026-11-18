import { isSignInRefusalError } from "./sign-in-refusal";

/** `PgServerError.body` when the refusal's body could not be read */
export const UNREADABLE_BODY = "<unreadable response body>";

/** What `PgServerError` is built from */
interface PgServerErrorInit {
  url: string;
  /** The HTTP status, `undefined` when the server did not answer */
  status: number | undefined;
  body: string;
  cause?: unknown;
  /**
   * What `/api/build-server` said when it refused: the words to show, and
   * why, e.g. `"signed-out"`. Absent for the build server's own errors.
   */
  refusal?: { error: string; reason?: string };
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
  /** Why `/api/build-server` refused, when it said, e.g. `"signed-out"` */
  readonly reason?: string;
  /**
   * A refusal for sign-in names something the person can do, so the
   * terminal prints it as a plain line rather than a process error
   */
  readonly isPlain: boolean;

  constructor(init: PgServerErrorInit) {
    super(
      init.refusal?.error ??
        `Server request failed (${init.url}): ${init.body}`,
      "cause" in init ? { cause: init.cause } : undefined
    );
    this.name = "PgServerError";
    this.url = init.url;
    this.status = init.status;
    this.body = init.body;
    this.reason = init.refusal?.reason;
    this.isPlain = isSignInRefusalError(this);
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
