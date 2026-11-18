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
 * @returns {Promise<Upstreams>}
 */
const upstreams = async (req) => {
  const full = compose(true);
  const open = compose(false);
  // The session is a database read, so it is looked up only when signing in changes the answer
  const signingInMatters =
    full.length !== open.length || full.some(hasCredentials);
  // The origin first, so another site cannot borrow a visitor's session
  const signedIn =
    signingInMatters &&
    isAllowedOrigin(req) &&
    (await readSession(req)).status === "signed-in";

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
    // An unparseable URL holds nothing to find; its other credentials still count
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
        // Not percent-encoded: the value as given is the one to find
      }
      return [
        value,
        decoded,
        encodeURIComponent(decoded),
        // How `searchParams.set` writes it: a space as `+`
        new URLSearchParams({ v: decoded }).toString().slice(2),
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
  } catch {
    // Nothing more to stop
  }
};

/**
 * The response body as text, refused once it passes `limit` bytes. A
 * `content-length` over the limit refuses it unread; the bytes are counted
 * while reading regardless, since that header can be absent or wrong, so the
 * rest is never buffered.
 *
 * @param {Response} response
 * @param {number} limit bytes
 */
const readCapped = async (response, limit) => {
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
 * @param {Upstream} upstream
 * @param {unknown} payload
 * @param {Limits} limits
 */
const exchange = async (upstream, payload, limits) => {
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
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
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
      const detail = await readCapped(response, limits.maxResponseBytes).catch(
        (/** @type {Error} */ e) => e.message
      );
      throw new Error(
        `${response.status} ${response.statusText}: ${detail.slice(0, 200)}`
      );
    }
    const text = await readCapped(response, limits.maxResponseBytes);

    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      return JSON.parse(text);
    }
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("data:")) return JSON.parse(line.slice(5).trim());
    }
    throw new Error("Upstream sent an event stream with no data.");
  } catch (e) {
    if (
      timedOut &&
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
 * quote the request it was given: its URL, its headers, its token.
 *
 * @param {Upstream} upstream
 * @param {unknown} payload
 * @param {Limits} limits
 */
export const callUpstream = async (upstream, payload, limits) => {
  try {
    return await exchange(upstream, payload, limits);
  } catch (e) {
    const redact = redactSecretsWith(secretsOf(upstream));
    throw new Error(redact(String(/** @type {Error} */ (e)?.message ?? e)));
  }
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
        configured[serverId],
        rpcRequest("tools/list"),
        limits
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
    configured[serverId],
    rpcRequest("tools/call", { ...params, name }),
    limits
  );

  return { ...payload, id };
};

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
async function handler(req, res) {
  warnAboutMissingObservabilityIds();
  let configured;
  try {
    configured = await upstreams(req);
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
    log.warn(`upstream call failed: ${message}`, { context: { method } });
    return sendRpcError(res, id, -32603, message);
  }
}

export default withObservability("mcp", handler);
