/**
 * The way to the Solana Foundation's build server (HOO-2422).
 *
 * The client's default build server is this route on its own origin; it
 * joins the build server's paths onto it (`/api/build-server/build`), and
 * `vercel.json` rewrites the subtree here with the remainder in `?path=`, as
 * it does for `/api/auth`. Only the paths the client calls are forwarded
 * (`features/build-server`).
 *
 * **Only a signed-in GitHub user builds.** The same Better Auth session and
 * `isAllowedOrigin` check as `/api/agent`; signed out is a `401` the Build
 * stage turns into a sign-in prompt, and unconfigured sign-in fails closed.
 *
 * **Every build is on record.** A `build_audit` row is written before a
 * `POST /build` (or its unstable twin) reaches the build server, and
 * completed when it answers: `499` when the caller left first, `502` when the
 * server could not be reached or refused this route. A build whose row cannot
 * be written is refused: an unrecorded build is what this prevents. A deploy
 * download needs the same sign-in and is not recorded.
 *
 * **The build server takes only this route.** It is sent
 * `PG_BUILD_SERVER_API_KEY` as `x-api-key`, the server's own `PG_API_KEY`;
 * with that set on the server, a request without the key is refused. A
 * production deployment without it says so once, reported. That is
 * what a proxy alone lacked (#22): the server's URL is public, so a gate in
 * front of an open server gates nothing.
 *
 * The answer keeps the build server's status and content type: a failed
 * compile's stderr is in the body and the client reads it. A build's answer
 * is read whole as text, for the audit; a deploy's binary is piped through. A build
 * can take minutes, so `vercel.json` gives this function `maxDuration` 300;
 * a caller that leaves aborts the request to the server.
 *
 * Plain ESM on raw Node request/response APIs — see `api/health.mjs` for why.
 */

import { validate as isUuid } from "uuid";

import {
  BodyTooLarge,
  readBoundedBody,
} from "../src/features/agent/server.mjs";
import {
  readJson,
  warnAboutMissingObservabilityIds,
  withObservability,
} from "../src/features/api/server.mjs";
import {
  isAllowedOrigin,
  readSession,
  SIGNED_OUT_REASON,
} from "../src/features/auth/server.mjs";
import {
  finishAuditWith,
  projectOf,
  resolveRoute,
  startAuditWith,
  upstreamPath,
} from "../src/features/build-server/server.mjs";
import { query } from "../src/features/persistence/server.mjs";
import { buildServerEnv } from "../src/shared/config/server-env.mjs";
import { createServerLogger } from "../src/shared/lib/logger/server.mjs";

const log = createServerLogger("api:build-server");

/** The build server's own default `PAYLOAD_LIMIT`; a larger body it refuses anyway */
const MAX_BODY_BYTES = 1024 * 1024;

/** What the audit records for a build whose caller left before the answer */
const CALLER_LEFT = 499;

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

/**
 * Copy the server's body to the caller, waiting on a full write buffer, until
 * either side stops.
 *
 * @param {import("node:http").ServerResponse} res
 * @param {ReadableStream<Uint8Array>} body
 */
const pipe = async (res, body) => {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || res.destroyed) break;
      if (!res.write(value)) {
        await new Promise((resolve) => {
          res.once("drain", resolve);
          res.once("close", resolve);
        });
      }
    }
  } finally {
    reader.cancel().catch((e) =>
      // The stream is done with either way; nothing is left to tell
      log.debug("cancelling the build server's body failed", {
        context: { message: String(e?.message ?? e) },
      })
    );
    if (!res.writableEnded) res.end();
  }
};

/**
 * Send the build server's status and content type on as this response's.
 *
 * @param {import("node:http").ServerResponse} res
 * @param {Response} upstream
 */
const relayHead = (res, upstream) => {
  res.statusCode = upstream.status;
  const type = upstream.headers.get("content-type");
  if (type) res.setHeader("content-type", type);
  res.setHeader("cache-control", "no-store");
};

/**
 * The program UUID a build belongs to: the one the server issued in its
 * answer, else the one the request carried. Only a UUID-shaped value is kept,
 * so a caller cannot write an arbitrary string into the audit.
 *
 * @param {unknown} request the parsed request body
 * @param {string} answer the server's response text
 */
const programUuidOf = (request, answer) => {
  let issued;
  try {
    issued = JSON.parse(answer)?.uuid;
  } catch {
    // Expected for an error: the build server answers those in plain text
    log.debug("build answer is not JSON; no UUID to record");
  }
  if (typeof issued === "string" && isUuid(issued)) return issued;
  const sent = /** @type {any} */ (request)?.uuid;
  return typeof sent === "string" && isUuid(sent) ? sent : undefined;
};

/**
 * The route, with what it reaches outside itself passed in; the default
 * export wires the real ones, the tests their own.
 *
 * @param {{
 *   readSession: typeof readSession;
 *   isAllowedOrigin: typeof isAllowedOrigin;
 *   query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
 *   fetch: typeof fetch;
 *   env: () => { URL: string; API_KEY?: string };
 *   isProduction: () => boolean;
 * }} deps
 */
export const handleWith = (deps) => {
  let warnedOpen = false;

  /**
   * A production deployment with no key leaves the build server open to
   * anyone who skips this route, which is the whole hole this route closes;
   * said once per instance, reported, and the build still goes through.
   */
  const warnIfOpen = (apiKey) => {
    if (apiKey || warnedOpen || !deps.isProduction()) return;
    warnedOpen = true;
    log.error(
      new Error(
        "PG_BUILD_SERVER_API_KEY is not set: the build server does not " +
          "require this route, so it is open to anyone"
      ),
      { report: true }
    );
  };

  /**
   * @param {import("node:http").IncomingMessage & { body?: unknown }} req
   * @param {import("node:http").ServerResponse} res
   */
  return async (req, res) => {
    const path = upstreamPath(req.url ?? "/") ?? "/";
    const route = resolveRoute(req.method ?? "GET", path);
    if (!route.ok) {
      if (route.status === 405) {
        res.setHeader("allow", route.allow);
        return sendJson(res, 405, { error: `Use ${route.allow} for ${path}.` });
      }
      return sendJson(res, 404, { error: "Not a build server route." });
    }

    if (route.kind === "deploy" && !isUuid(route.programId)) {
      return sendJson(res, 404, { error: "Not a build server route." });
    }

    // A caller who leaves stops the build server's request too. Listening
    // before the first wait, so a caller gone before the forward is seen
    const abort = new AbortController();
    res.on?.("close", () => abort.abort());

    // Who is asking comes first, so a refused caller costs nothing
    if (!deps.isAllowedOrigin(req)) {
      return sendJson(res, 403, { error: "Cross-origin request refused" });
    }
    const session = await deps.readSession(req);
    if (session.status === "unconfigured") {
      return sendJson(res, 503, {
        error:
          "Sign-in is not configured on this deployment, so it cannot build. " +
          "Pick another build server in Settings.",
      });
    }
    if (session.status === "unavailable") {
      return sendJson(res, 503, {
        error: "Sign-in is unavailable right now. Try again shortly.",
      });
    }
    if (session.status !== "signed-in") {
      return sendJson(res, 401, {
        error: "Sign in with GitHub to build.",
        reason: SIGNED_OUT_REASON,
      });
    }

    /** @type {string | undefined} */
    let body;
    /** @type {unknown} */
    let json;
    let bytes = 0;
    if (route.kind === "build") {
      try {
        const read = await readBoundedBody(req, MAX_BODY_BYTES);
        json = await readJson({ body: read.body });
        // Vercel may hand the body over parsed; the server gets it as JSON again
        body = typeof read.body === "string" ? read.body : JSON.stringify(json);
        bytes = read.bytes;
      } catch (e) {
        if (e instanceof BodyTooLarge) {
          return sendJson(res, 413, { error: e.message });
        }
        return sendJson(res, 400, {
          error: `Malformed request body: ${e.message}`,
        });
      }
    }

    /** @type {number | undefined} */
    let auditId;
    if (route.kind === "build") {
      try {
        auditId = await startAuditWith(deps.query)({
          userId: session.user.id,
          project: projectOf(json),
          unstable: route.unstable,
          bytes,
        });
      } catch (e) {
        log.error(e, { report: true, context: { op: "startAudit" } });
        return sendJson(res, 503, {
          error: "Builds cannot be recorded right now. Try again shortly.",
        });
      }
    }

    const started = Date.now();
    /**
     * @param {number} status what the audit records
     * @param {string} answer the build server's answer, for the program UUID;
     *   empty when there is none
     */
    const finish = (status, answer) =>
      auditId === undefined
        ? Promise.resolve()
        : finishAuditWith(deps.query)({
            id: auditId,
            programUuid: programUuidOf(json, answer),
            status,
            durationMs: Date.now() - started,
          });

    const { URL: base, API_KEY } = deps.env();
    warnIfOpen(API_KEY);
    /** @type {Record<string, string>} */
    const headers = { accept: req.headers.accept ?? "*/*" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (API_KEY) headers["x-api-key"] = API_KEY;

    // A caller who left while the route waited (session, body, audit) is
    // not worth a build: the close already fired, so nothing would abort it
    if (res.destroyed || abort.signal.aborted) {
      await finish(CALLER_LEFT, "");
      return;
    }

    let upstream;
    try {
      upstream = await deps.fetch(`${base}${path}`, {
        method: req.method,
        headers,
        body,
        signal: abort.signal,
      });
    } catch (e) {
      if (res.destroyed || e?.name === "AbortError") {
        await finish(CALLER_LEFT, "");
        return;
      }
      log.warn("build server unreachable", {
        context: { path, message: String(e?.cause?.code ?? e?.message ?? e) },
      });
      await finish(502, "");
      return sendJson(res, 502, {
        error: "The build server did not answer. Try again shortly.",
      });
    }

    // The server refusing this route is our misconfiguration (a key that
    // differs on the two sides), never the user's: say so, and report it
    if (upstream.status === 401 || upstream.status === 403) {
      log.error(
        new Error(`build server refused the route's key (${upstream.status})`),
        { report: true, context: { path } }
      );
      upstream.body?.cancel().catch((e) =>
        log.debug("cancelling a refused answer's body failed", {
          context: { message: String(e?.message ?? e) },
        })
      );
      await finish(502, "");
      return sendJson(res, 502, {
        error: "The build server refused this site. Try again later.",
      });
    }
    if (upstream.status >= 500) {
      log.warn("build server answered with an error", {
        context: { path, status: upstream.status },
      });
    }

    if (route.kind === "build") {
      // A build's answer is JSON or a short error text, read whole for the
      // audit and sent on as text
      let text;
      try {
        text = await upstream.text();
      } catch (e) {
        if (res.destroyed || abort.signal.aborted) {
          await finish(CALLER_LEFT, "");
          return;
        }
        log.warn("build server answer could not be read", {
          context: { path, message: String(e?.message ?? e) },
        });
        await finish(502, "");
        return sendJson(res, 502, {
          error: "The build server's answer was cut off. Try again.",
        });
      }
      if (res.destroyed) {
        await finish(CALLER_LEFT, "");
        return;
      }
      await finish(upstream.status, text);
      relayHead(res, upstream);
      return res.end(text);
    }

    relayHead(res, upstream);
    if (!upstream.body) return res.end();
    await pipe(res, upstream.body);
  };
};

export default withObservability(
  "build-server",
  (() => {
    const handler = handleWith({
      readSession,
      isAllowedOrigin,
      query,
      fetch: (...args) => fetch(...args),
      env: buildServerEnv,
      isProduction: () => process.env.VERCEL_ENV === "production",
    });
    return (req, res) => {
      warnAboutMissingObservabilityIds();
      return handler(req, res);
    };
  })()
);
