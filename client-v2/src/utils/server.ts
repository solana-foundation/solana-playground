import type { Idl } from "@coral-xyz/anchor";

import { createLogger } from "@/shared/lib/logger";

import { BUILD_SERVER_ROUTE } from "../settings/server/default-endpoint";
import { PgCommon } from "./common";
import type { TupleFiles } from "./explorer";
import { PgServerError, UNREADABLE_BODY } from "./server-error";
import { PgSettings } from "./settings";

export { PgServerError };

const log = createLogger("utils:server");

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
  /**
   * The project being built, for the audit `/api/build-server` keeps. Sent
   * only to that route: another server has no use for the workspace's name.
   */
  project?: { id: string; name: string };
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

    const isRoute = PgSettings.server.endpoint === BUILD_SERVER_ROUTE;
    const body = isRoute
      ? req
      : { files: req.files, uuid: req.uuid, flags: req.flags };
    const response = await this._send("/build", {
      post: { body: JSON.stringify(body) },
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
        refusal: refusalOf(body),
      });
    }

    return response;
  }
}

/**
 * A refusal `/api/build-server` explains: JSON with the words to show and,
 * where the client acts on it, a `reason` such as `"signed-out"`. The build
 * server's own errors are plain text and are not one.
 */
const refusalOf = (text: string) => {
  try {
    const { error, reason } = JSON.parse(text) ?? {};
    if (typeof error !== "string") return undefined;
    return { error, reason: typeof reason === "string" ? reason : undefined };
  } catch {
    // Expected: the build server answers its own errors in plain text
    log.debug("server error is not JSON; shown as text");
    return undefined;
  }
};
