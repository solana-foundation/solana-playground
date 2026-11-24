// @ts-check
/**
 * MCP gateway.
 *
 * Reaches MCP servers a page cannot: `mcp.solana.com` sends no CORS headers,
 * so the browser is refused, while this runs server-side where CORS does not
 * apply. Speaks MCP in and MCP out — the JSON-RPC envelope is forwarded
 * verbatim — so the browser client needs a different URL and nothing else.
 *
 * `?server[]=solana&server[]=explorer` selects upstreams; omitting it selects
 * every configured one. With a single upstream the call is a pass-through.
 * With several, `tools/list` is merged with `<id>__` prefixes and `tools/call`
 * routes on that prefix, so the caller sees one MCP server.
 *
 * Upstreams come from the server's own configuration (`composeServers`: the
 * `mcp` entries of `SOURCES_CATALOGUE`, or of `SOURCES`, filled from the environment)
 * and never from the request. A gateway that dials a caller-supplied host is
 * an SSRF and an open relay; refusing the input removes the whole class.
 * Adding one is a deploy, or an operator setting the variables it names.
 *
 * Every request is bounded (`mcpEnv`): an upstream call is cut after
 * `MCP_TIMEOUT_MS`, a request body over `MCP_MAX_REQUEST_BYTES` is refused
 * with 413, and an upstream response over `MCP_MAX_RESPONSE_BYTES` is refused.
 * An upstream failure reaches the caller, and the log, with every credential
 * of four or more characters the entry carries removed (`secretsOf`).
 *
 * Plain ESM on raw Node request/response APIs — see `api/health.mjs` for why.
 */

import {
  BodyTooLarge,
  readBoundedBody,
  redactSecretsWith,
} from "../src/features/agent/server.mjs";
import {
  readJson,
  warnAboutMissingObservabilityIds,
  withObservability,
} from "../src/features/api/server.mjs";
import { isAllowedOrigin, readSession } from "../src/features/auth/server.mjs";
import {
  composeServers,
  protectionHeaders,
} from "../src/features/mcp/server.mjs";
import { mcpEnv, sourcesEnv } from "../src/shared/config/server-env.mjs";
import {
  rpcError,
  rpcRequest,
  rpcResult,
} from "../src/shared/lib/json-rpc.mjs";
import { createServerLogger } from "../src/shared/lib/logger/server.mjs";

const log = createServerLogger("api:mcp");

const PROTOCOL_VERSION = "2025-06-18";

/** Separates upstream id from tool name when several are selected */
const SEPARATOR = "__";

/** @typedef {import("../src/shared/lib/json-rpc.mjs").RpcId} RpcId */

/** @typedef {import("../src/features/mcp/model/types").McpServerEntry} Upstream */

/** @typedef {Record<string, Upstream>} Upstreams by id */

/**
 * Who is calling: whether the request comes from this site, and its session.
 *
 * @typedef {{
 *   isAllowedOrigin: typeof isAllowedOrigin,
 *   readSession: (req: import("node:http").IncomingMessage) => Promise<{ status: string }>,
 * }} Session
 */

/**
 * How long one upstream call may run, and the largest response it may send.
 *
 * @typedef {{ timeoutMs: number, maxResponseBytes: number }} Limits
 */

/**
 * A value shorter than this is not removed from error text: it is no
 * credential (a flag such as `1`), and removing it would mangle every number
 * in the message, the status code included.
 */
const MIN_SECRET_LENGTH = 4;

/**
 * The request body as the gateway reads it: unvalidated, its `id` echoed back verbatim.
 *
 * @typedef {object} RpcRequestBody
 * @property {RpcId} id
 * @property {unknown} method
 * @property {Record<string, unknown>} [params]
 */

/** @param {Upstream} server */
const hasCredentials = (server) =>
  Boolean(
    server.protection ||
      server.authToken ||
      Object.keys(server.headers ?? {}).length ||
      Object.keys(server.queryParams ?? {}).length
  );

/** @param {Upstream} server */
const withoutCredentials = (server) => ({
  ...server,
  headers: undefined,
  queryParams: undefined,
  authToken: undefined,
  protection: undefined,
});

/** @param {boolean} signedIn */
const compose = (signedIn) =>
  composeServers({
    env: process.env,
    override: sourcesEnv().SOURCES,
    signedIn,
  });

/**
 * The upstreams this request may use, by id.
 *
 * Which exist is the catalogue's business (`shared/config/sources.mjs`):
 * an entry whose variables are unset is absent, and a `signedIn` one is absent
 * for an anonymous caller. An entry's credentials (headers, query values,
 * token, bot-protection bypass) are the deployment's, so they are sent only
 * for a signed-in caller on this site; anyone else reaches the same upstream
 * without them, and brings their own keys through a browser entry.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {Session} session
 * @returns {Promise<Upstreams>}
 */
const upstreams = async (req, session) => {
  const full = compose(true);
  const open = compose(false);
  // The session is a database read, so it is looked up only when signing in changes the answer
  const signingInMatters =
    full.length !== open.length || full.some(hasCredentials);
  // The origin first, so another site cannot borrow a visitor's session
  const signedIn =
    signingInMatters &&
    session.isAllowedOrigin(req) &&
    (await session.readSession(req)).status === "signed-in";

  const servers = signedIn ? full : open.map(withoutCredentials);
  return Object.fromEntries(servers.map((s) => [s.id, s]));
};

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

/**
 * A JSON-RPC error with HTTP 200: the transport worked, the call did not.
 *
 * @param {import("node:http").ServerResponse} res
 * @param {RpcId} id
 * @param {number} code
 * @param {string} message
 */
const sendRpcError = (res, id, code, message) =>
  sendJson(res, 200, rpcError(id, code, message));

/**
 * Which upstreams this request is for, defaulting to all of them.
 *
 * @param {URL} url
 * @param {Upstreams} configured
 */
const selected = (url, configured) => {
  // Accepts `server[]=x` and `server=x`, repeated
  const asked = [
    ...url.searchParams.getAll("server[]"),
    ...url.searchParams.getAll("server"),
  ];
  if (!asked.length) return Object.keys(configured);

  const unknown = asked.filter((id) => !configured[id]);
  if (unknown.length) {
    throw new Error(
      `Unknown server: ${unknown.join(", ")}. Configured: ${
        Object.keys(configured).join(", ") || "none"
      }.`
    );
  }
  return asked;
};

/**
 * Every credential an entry carries, for removal from error text: its token,
 * header values, query values, bot-protection bypass, and whatever its URL
 * holds in user info or query. Each in its percent-encoded forms too, since an
 * error that quotes the request URL quotes them encoded.
 *
 * @param {Upstream} upstream
 */
const secretsOf = (upstream) => {
  let url;
  try {
    url = new URL(upstream.url);
  } catch {
    // Its other credentials still count; `exchange` reports the URL itself
    log.warn(`upstream "${upstream.id}" has an unparseable URL`);
  }
  const values = [
    upstream.authToken,
    upstream.protection?.secret,
    ...Object.values(upstream.headers ?? {}),
    ...Object.values(upstream.queryParams ?? {}),
    // `URL` keeps user info percent-encoded; the decoded form is added below
    url?.username,
    url?.password,
    ...(url ? [...url.searchParams.values()] : []),
  ]
    .filter((value) => value !== undefined && value !== null)
    .map(String);

  return values
    .flatMap((value) => {
      let decoded = value;
      try {
        decoded = decodeURIComponent(value);
      } catch {
        // A stray `%`: the value as given is the one to find
        log.debug(
          "a credential is not percent-decodable; matching it as given"
        );
      }
      return [
        value,
        decoded,
        encodeURIComponent(decoded),
        // How `searchParams.set` writes it: a space as `+`
        new URLSearchParams({ v: decoded }).toString().slice(2),
        // The token of a header value such as `Bearer <token>`
        decoded.replace(/^[A-Za-z]+ +/, ""),
      ];
    })
    .filter((secret) => secret.length >= MIN_SECRET_LENGTH);
};

/**
 * Stop reading a response being refused. A cancel that fails (the stream
 * already errored) is ignored: the refusal is the error worth reporting.
 *
 * @param {{ cancel: () => Promise<void> } | null} stream
 */
const cancelQuietly = async (stream) => {
  try {
    await stream?.cancel();
  } catch (e) {
    log.debug(`cancelling a refused response failed: ${String(e)}`);
  }
};

/**
 * The response body as text, refused once it passes `limit` bytes. A
 * `content-length` over the limit refuses it unread; the bytes are counted
 * while reading regardless, since that header can be absent or wrong, so the
 * rest is never buffered.
 *
 * @param {number} limit bytes
 * @param {Response} response
 */
const readCapped = async (limit, response) => {
  const tooLarge = () =>
    new Error(`Upstream response is larger than ${limit} bytes.`);
  if (Number(response.headers.get("content-length")) > limit) {
    await cancelQuietly(response.body);
    throw tooLarge();
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      // Stop reading: the rest is never buffered
      await cancelQuietly(reader);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
};

/**
 * One JSON-RPC round trip to an upstream.
 *
 * Streamable HTTP answers with JSON or a one-event SSE stream, so both are
 * unwrapped here and the caller only ever sees JSON.
 *
 * @param {Limits} limits
 * @param {Upstream} upstream
 * @param {(text: string) => string} redact applied to an error page before
 *   it is cut, so the cut cannot leave a credential's first characters
 * @param {unknown} payload
 */
const exchange = async (limits, upstream, redact, payload) => {
  // The entry's `authToken` and `queryParams` mean here what they mean in the browser (`features/mcp`)
  const url = new URL(upstream.url);
  for (const [key, value] of Object.entries(upstream.queryParams ?? {})) {
    url.searchParams.set(key, value);
  }
  // Covers the body too: aborting the request ends its response stream. The
  // flag tells the timer's abort from any other failure, and the timer is
  // cleared once the call settles.
  const controller = new AbortController();
  const { signal } = controller;
  let hasTimedOut = false;
  const timer = setTimeout(() => {
    hasTimedOut = true;
    controller.abort();
  }, limits.timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL_VERSION,
        ...(upstream.authToken
          ? { authorization: `Bearer ${upstream.authToken}` }
          : {}),
        ...protectionHeaders(upstream.protection),
        ...upstream.headers,
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      // An oversized error page still reports its status
      // The timer's abort goes on to the timeout check below
      const detail = await readCapped(limits.maxResponseBytes, response).catch(
        (/** @type {Error} */ e) => {
          if (hasTimedOut) throw e;
          return e.message;
        }
      );
      throw new Error(
        `${response.status} ${response.statusText}: ${redact(detail).slice(
          0,
          200
        )}`
      );
    }
    const text = await readCapped(limits.maxResponseBytes, response);

    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      return JSON.parse(text);
    }
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("data:")) return JSON.parse(line.slice(5).trim());
    }
    throw new Error("Upstream sent an event stream with no data.");
  } catch (e) {
    if (
      hasTimedOut &&
      (e === signal.reason || /** @type {Error} */ (e)?.name === "AbortError")
    ) {
      throw new Error(
        `Upstream "${upstream.id}" did not answer within ${limits.timeoutMs} ms.`
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * {@link exchange}, with the entry's credentials removed from any error it
 * raises. The error text is the upstream's or the platform's, and either can
 * quote the request it was given: its URL, its headers, its token. A JSON-RPC
 * error the upstream answers with has every string redacted the same way.
 *
 * @param {Limits} limits
 * @param {Upstream} upstream
 * @param {unknown} payload
 */
export const callUpstream = async (limits, upstream, payload) => {
  const redact = redactSecretsWith(secretsOf(upstream));
  let answer;
  try {
    answer = await exchange(limits, upstream, redact, payload);
  } catch (e) {
    throw new Error(redact(String(/** @type {Error} */ (e)?.message ?? e)));
  }
  return withRedactedError(redact, answer);
};

/**
 * `value` with every string in it redacted, at any depth.
 *
 * @param {(text: string) => string} redact
 * @param {unknown} value
 * @returns {unknown}
 */
const redactStrings = (redact, value) => {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((v) => redactStrings(redact, v));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactStrings(redact, v)])
    );
  }
  return value;
};

/**
 * `answer` with every string of its JSON-RPC error redacted. An upstream can
 * refuse a call with HTTP 200 and an `error` that quotes what it was sent; a
 * result passes untouched.
 *
 * @template T
 * @param {(text: string) => string} redact
 * @param {T} answer
 * @returns {T}
 */
const withRedactedError = (redact, answer) => {
  const envelope = /** @type {{ error?: unknown }} */ (answer);
  if (!envelope?.error || typeof envelope.error !== "object") return answer;
  return /** @type {T} */ ({
    ...envelope,
    error: redactStrings(redact, envelope.error),
  });
};

/**
 * `initialize` is answered here: there is no single upstream to forward it to
 *
 * @param {RpcId} id
 * @param {string[]} ids
 */
const initialize = (id, ids) =>
  rpcResult(id, {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "solana-playground-gateway", version: "0.1.0" },
    instructions:
      `Tools proxied from: ${ids.join(", ")}.` +
      (ids.length > 1
        ? ` Names are prefixed with the upstream id and "${SEPARATOR}".`
        : ""),
  });

/**
 * Merge every selected upstream's tools, prefixing only when disambiguation is needed
 *
 * @param {RpcId} id
 * @param {string[]} ids
 * @param {Upstreams} configured
 * @param {Limits} limits
 */
const listTools = async (id, ids, configured, limits) => {
  const prefix = ids.length > 1;
  const lists = await Promise.all(
    ids.map(async (serverId) => {
      const payload = await callUpstream(
        limits,
        configured[serverId],
        rpcRequest("tools/list")
      );
      /** @type {Array<{ name: string } & Record<string, unknown>>} */
      const tools = payload.result?.tools ?? [];
      return prefix
        ? tools.map((tool) => ({
            ...tool,
            name: `${serverId}${SEPARATOR}${tool.name}`,
          }))
        : tools;
    })
  );

  return rpcResult(id, { tools: lists.flat() });
};

/**
 * Route a call by its name prefix when several upstreams are in play
 *
 * @param {RpcId} id
 * @param {string[]} ids
 * @param {Upstreams} configured
 * @param {Record<string, unknown> | undefined} params
 * @param {Limits} limits
 */
const callTool = async (id, ids, configured, params, limits) => {
  let serverId = ids[0];
  let name = params?.name;

  if (ids.length > 1) {
    const at = String(name ?? "").indexOf(SEPARATOR);
    if (at < 0)
      throw new Error(`Tool name must be prefixed with an upstream id`);
    serverId = String(name).slice(0, at);
    name = String(name).slice(at + SEPARATOR.length);
    if (!ids.includes(serverId))
      throw new Error(`Unknown upstream "${serverId}"`);
  }

  const payload = await callUpstream(
    limits,
    configured[serverId],
    rpcRequest("tools/call", { ...params, name })
  );

  return { ...payload, id };
};

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {Session} session
 */
async function handle(req, res, session) {
  warnAboutMissingObservabilityIds();
  let configured;
  try {
    configured = await upstreams(req, session);
  } catch (e) {
    // A broken catalogue fails every request, with the entry at fault named, rather than serving part of it
    log.error(e, { report: true });
    return sendJson(res, 500, { error: /** @type {Error} */ (e).message });
  }

  // Discovery. The server decides which upstreams exist — the client asks
  // rather than carrying its own list, so adding one is a deploy and an
  // operator can enable one by setting its variables with no client change.
  // Ids and names only; nothing here reveals a credential.
  if (req.method === "GET") {
    return sendJson(res, 200, {
      servers: Object.entries(configured).map(([id, upstream]) => ({
        id,
        name: upstream.name ?? id,
      })),
    });
  }

  if (req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return sendJson(res, 405, {
      error: "Use GET to list servers, POST for JSON-RPC.",
    });
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const bounds = mcpEnv();
  /** @type {Limits} */
  const limits = {
    timeoutMs: bounds.MCP_TIMEOUT_MS,
    maxResponseBytes: bounds.MCP_MAX_RESPONSE_BYTES,
  };

  let body;
  let ids;
  try {
    const read = await readBoundedBody(req, bounds.MCP_MAX_REQUEST_BYTES);
    // `readBoundedBody` drained the stream, so `readJson` gets the text as a pre-parsed body
    body = await readJson(
      /** @type {import("node:http").IncomingMessage} */ (
        /** @type {unknown} */ ({ body: read.body })
      )
    );
    ids = selected(url, configured);
  } catch (e) {
    const status = e instanceof BodyTooLarge ? 413 : 400;
    return sendJson(res, status, { error: /** @type {Error} */ (e).message });
  }

  const { id, method, params } = /** @type {RpcRequestBody} */ (body);

  // A notification carries no id and expects no response body
  if (typeof method === "string" && method.startsWith("notifications/")) {
    res.statusCode = 202;
    return res.end();
  }

  try {
    switch (method) {
      case "initialize":
        return sendJson(res, 200, initialize(id, ids));
      case "tools/list":
        return sendJson(res, 200, await listTools(id, ids, configured, limits));
      case "tools/call":
        return sendJson(
          res,
          200,
          await callTool(id, ids, configured, params, limits)
        );
      default:
        return sendRpcError(res, id, -32601, `Method not supported: ${method}`);
    }
  } catch (e) {
    // An upstream failure is the model's business, not a transport error.
    // Its message is redacted already (`callUpstream`), so it is logged as is.
    const message = /** @type {Error} */ (e).message;
    log.warn(`request failed: ${message}`, { context: { method } });
    return sendRpcError(res, id, -32603, message);
  }
}

/**
 * The route, with how it learns who is calling passed in, so
 * `api/mcp.test.mjs` can drive a signed-in caller without a database.
 *
 * @param {Session} session
 */
export const handleWith =
  (session) =>
  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  (req, res) =>
    handle(req, res, session);

export default withObservability(
  "mcp",
  handleWith({ isAllowedOrigin, readSession })
);
