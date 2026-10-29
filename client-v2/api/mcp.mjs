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
 * Upstreams are configured here and never taken from the request. A gateway
 * that dials a caller-supplied host is an SSRF and an open relay; refusing the
 * input removes the whole class. Adding one is a deploy, and the only thing the
 * environment may move is the URL of an upstream already named here.
 *
 * Plain ESM on raw Node request/response APIs — see `api/health.mjs` for why.
 */

import {
  readJson,
  warnAboutMissingObservabilityIds,
  withObservability,
} from "../src/features/api/server.mjs";
import { isAllowedOrigin, readSession } from "../src/features/auth/server.mjs";
import { mcpExplorerEnv } from "../src/shared/config/server-env.mjs";
import {
  rpcError,
  rpcRequest,
  rpcResult,
} from "../src/shared/lib/json-rpc.mjs";

const PROTOCOL_VERSION = "2025-06-18";

/** Separates upstream id from tool name when several are selected */
const SEPARATOR = "__";

/** @typedef {import("../src/shared/lib/json-rpc.mjs").RpcId} RpcId */

/**
 * @typedef {object} Upstream
 * @property {string} name
 * @property {string} url
 * @property {Record<string, string>} [headers] sent on every request to it
 */

/** @typedef {Record<string, Upstream>} Upstreams by id */

/**
 * The request body as the gateway reads it: unvalidated, its `id` echoed back verbatim.
 *
 * @typedef {object} RpcRequestBody
 * @property {RpcId} id
 * @property {unknown} method
 * @property {Record<string, unknown>} [params]
 */

/**
 * The upstreams this caller may use.
 *
 * Explorer is present only when a bypass is supplied through the environment,
 * and only to a signed-in caller. Its endpoint sits behind bot protection its
 * owners chose to switch on, and our bypass secret rides on every request to
 * it, so an anonymous caller would get a way around that protection. Left
 * unset, the panel's Explorer entry has nothing to talk to, which is why it
 * also ships disabled. The Solana upstream is public and stays open: the
 * bring-your-own-key backends call it signed out.
 *
 * @param {{ signedIn: boolean }} caller
 */
const upstreams = (caller) => {
  /** @type {Upstreams} */
  const configured = {
    solana: {
      name: "Solana Developer MCP",
      url: "https://mcp.solana.com/mcp",
    },
  };

  const explorer = mcpExplorerEnv();
  if (explorer.BYPASS && caller.signedIn) {
    configured.explorer = {
      name: "Solana Explorer MCP",
      url: explorer.URL,
      headers: {
        "x-vercel-protection-bypass": explorer.BYPASS,
        // Explorer gates on MCP_ACCESS_KEYS when its deployment sets them
        ...(explorer.TOKEN
          ? { authorization: `Bearer ${explorer.TOKEN}` }
          : {}),
      },
    };
  }

  return configured;
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

/** What a caller asking for Explorer is told, by why it is withheld */
const EXPLORER_HINTS = {
  "no-bypass": " Set MCP_EXPLORER_BYPASS on the server to enable explorer.",
  "foreign-origin": " Explorer is offered only to requests from this site.",
  unconfigured:
    " Sign-in is not configured on this deployment, so explorer is off.",
  unavailable: " Sign-in is unavailable right now. Try explorer again shortly.",
  "signed-out": " Sign in with GitHub to use explorer.",
};

/**
 * Why Explorer is withheld from this request, or `null` when it is offered.
 *
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<keyof typeof EXPLORER_HINTS | null>}
 */
const explorerWithheld = async (req) => {
  if (!mcpExplorerEnv().BYPASS) return "no-bypass";
  // Before the session, so another site cannot borrow a visitor's; the lookup is also a database read
  if (!isAllowedOrigin(req)) return "foreign-origin";
  const session = await readSession(req);
  return session.status === "signed-in" ? null : session.status;
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
 * @param {keyof typeof EXPLORER_HINTS | null} withheld why Explorer is absent, for the error
 */
const selected = (url, configured, withheld) => {
  // Accepts `server[]=x` and `server=x`, repeated
  const asked = [
    ...url.searchParams.getAll("server[]"),
    ...url.searchParams.getAll("server"),
  ];
  if (!asked.length) return Object.keys(configured);

  const unknown = asked.filter((id) => !configured[id]);
  if (unknown.length) {
    // Explorer's absence has a reason of its own, not a typo
    const hint =
      unknown.includes("explorer") && withheld ? EXPLORER_HINTS[withheld] : "";
    throw new Error(
      `Unknown server: ${unknown.join(", ")}. Configured: ${
        Object.keys(configured).join(", ") || "none"
      }.${hint}`
    );
  }
  return asked;
};

/**
 * One JSON-RPC round trip to an upstream.
 *
 * Streamable HTTP answers with JSON or a one-event SSE stream, so both are
 * unwrapped here and the caller only ever sees JSON.
 *
 * @param {Upstream} upstream
 * @param {unknown} payload
 */
const call = async (upstream, payload) => {
  const response = await fetch(upstream.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
      ...upstream.headers,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}: ${text.slice(0, 200)}`
    );
  }

  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return JSON.parse(text);
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data:")) return JSON.parse(line.slice(5).trim());
  }
  throw new Error("Upstream sent an event stream with no data.");
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
 */
const listTools = async (id, ids, configured) => {
  const prefix = ids.length > 1;
  const lists = await Promise.all(
    ids.map(async (serverId) => {
      const payload = await call(
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
 */
const callTool = async (id, ids, configured, params) => {
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

  const payload = await call(
    configured[serverId],
    rpcRequest("tools/call", { ...params, name })
  );

  return { ...payload, id };
};

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
async function handler(req, res) {
  warnAboutMissingObservabilityIds();
  const withheld = await explorerWithheld(req);
  const configured = upstreams({ signedIn: withheld === null });

  // Discovery. The server decides which upstreams exist — the client asks
  // rather than carrying its own list, so adding one is a deploy and an
  // operator can enable Explorer by setting its bypass with no client change.
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

  let body;
  let ids;
  try {
    body = await readJson(req);
    ids = selected(url, configured, withheld);
  } catch (e) {
    return sendJson(res, 400, { error: /** @type {Error} */ (e).message });
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
        return sendJson(res, 200, await listTools(id, ids, configured));
      case "tools/call":
        return sendJson(res, 200, await callTool(id, ids, configured, params));
      default:
        return sendRpcError(res, id, -32601, `Method not supported: ${method}`);
    }
  } catch (e) {
    // An upstream failure is the model's business, not a transport error
    return sendRpcError(res, id, -32603, /** @type {Error} */ (e).message);
  }
}

export default withObservability("mcp", handler);
