import { isBusyRefusalError } from "./busy-refusal";
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
  /**
   * Seconds the server asked the caller to wait (`Retry-After`), read only
   * from a `429` or `503`; absent when it did not say
   */
  retryAfterSeconds?: number;
}

/**
 * The seconds a `Retry-After` header asks for. Only the delay form, which
 * `/api/build-server` sends; a date, a fraction or a negative number is
 * not read.
 *
 * @param value the header's value, `null` when the response had none
 */
export const parseRetryAfter = (value: string | null): number | undefined => {
  if (value === null || !/^\d+$/.test(value.trim())) return undefined;
  return Number(value.trim());
};

/**
 * What a busy answer says when it came without `/api/build-server`'s own
 * words: the build server's full queue (HOO-2908) answers `503` with
 * `Retry-After` and a plain-text body meant for logs, not for the Build stage
 */
export const BUSY_SERVER_MESSAGE =
  "The build server is busy: too many builds are running.";

/** The words a failed request shows: the refusal's, a busy answer's, or the raw body */
const messageOf = (init: PgServerErrorInit): string => {
  if (init.refusal) return init.refusal.error;
  if (isBusyRefusalError(init)) return BUSY_SERVER_MESSAGE;
  return `Server request failed (${init.url}): ${init.body}`;
};

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
  /** How long the server asked to wait before trying again, when it did */
  readonly retryAfterSeconds?: number;
  /**
   * A refusal for sign-in, or for a busy service, names something the person
   * can do, so the terminal prints it as a plain line rather than a process
   * error
   */
  readonly isPlain: boolean;

  constructor(init: PgServerErrorInit) {
    super(messageOf(init), "cause" in init ? { cause: init.cause } : undefined);
    this.name = "PgServerError";
    this.url = init.url;
    this.status = init.status;
    this.body = init.body;
    this.reason = init.refusal?.reason;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.isPlain = isSignInRefusalError(this) || isBusyRefusalError(this);
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
