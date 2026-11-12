import type { Idl } from "@coral-xyz/anchor";

import { PgCommon } from "./common";
import type { TupleFiles } from "./explorer";
import { PgServerError, UNREADABLE_BODY } from "./server-error";
import { PgSettings } from "./settings";

export { PgServerError };

/** Rust `Option` type */
type Option<T> = T | null;

/** `/build` request */
interface BuildRequest {
  /** Program files */
  files: TupleFiles;
  /** UUID of the program */
  uuid?: Option<string>;
  /** Build flags */
  flags?: Option<{
    /** Whether to enable Anchor `seeds` feature */
    seedsFeature?: Option<boolean>;
    /** Whether to remove docs from the Anchor IDL */
    noDocs?: Option<boolean>;
    /** Whether to enable Anchor safety checks */
    safetyChecks?: Option<boolean>;
  }>;
}

export class PgServer {
  /**
   * Build the program files.
   *
   * @param req build request
   * @param opts.signal aborts the request
   * @returns the build response
   */
  static async build(req: BuildRequest, opts?: { signal?: AbortSignal }) {
    interface BuildResponse {
      /** Build output */
      stderr: string;
      /** UUID of the program */
      uuid: Option<string>;
      /** Anchor IDL */
      idl: Option<Idl>;
    }

    const response = await this._send("/build", {
      post: { body: JSON.stringify(req) },
      unstable: PgSettings.experimental.unstable,
      signal: opts?.signal,
    });
    return (await response.json()) as BuildResponse;
  }

  /**
   * Get the program ELF.
   *
   * NOTE: The server is only responsible for sending the program binary to the
   * client. The deployment process is done in the client.
   *
   * @param uuid unique project id
   * @returns the program binary bytes
   */
  static async deploy(uuid: string) {
    const response = await this._send(`/deploy/${uuid}`, {
      unstable: PgSettings.experimental.unstable,
    });
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  /**
   * Send an HTTP request to the Playground server.
   *
   * @param opts server send request options; an aborted `signal` fails the
   * request like any other network failure ("Server request failed")
   * @throws when the response is not OK (with the decoded response)
   * @returns the HTTP response
   */
  private static async _send(
    path: string,
    opts?: {
      post?: { body: string };
      unstable?: boolean;
      signal?: AbortSignal;
    }
  ) {
    const requestInit: RequestInit = {
      signal: opts?.signal,
      cache: "no-store",
    };

    if (opts?.post) {
      requestInit.method = "POST";
      requestInit.headers = { "Content-Type": "application/json" };
      requestInit.body = opts.post.body;
    }

    if (opts?.unstable) path = PgCommon.joinPaths("unstable", path);
    const requestUrl = PgCommon.joinPaths(PgSettings.server.endpoint, path);
    let response: Response;
    try {
      response = await fetch(requestUrl, requestInit);
    } catch (e: any) {
      throw new PgServerError({
        url: requestUrl,
        status: undefined,
        body: e?.message || String(e),
        cause: e,
      });
    }
    if (!response.ok) {
      // A body cut off mid-read still leaves the status to report; the
      // placeholder says in the error's message that the body was lost
      const body = await response.text().catch(() => UNREADABLE_BODY);
      throw new PgServerError({
        url: requestUrl,
        status: response.status,
        body,
      });
    }

    return response;
  }
}
