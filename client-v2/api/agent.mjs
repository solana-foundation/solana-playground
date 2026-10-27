/**
 * Default backend rail.
 *
 * Speaks chat-completions in and out, so the panel's existing provider loop
 * reaches it by URL alone and needs no protocol of its own. The upstream, its
 * key and the model are configured here from the environment and never taken
 * from the request — same rule as `api/mcp.mjs`, and for the same reason.
 *
 * What runs behind it is a deploy-time choice, read from the environment by
 * `upstream`. The wire shape is the contract; nothing else is promised.
 *
 * **Only a signed-in caller from our own site spends the key.** A turn needs a
 * Better Auth session, the same GitHub sign-in the sync routes use, and passes
 * the same `isAllowedOrigin` check; a deployment without sign-in configured
 * serves no turns at all. That bounds who can spend the key, not how much:
 * per-session and daily caps are HOO-1751, and the Vercel Firewall rate limit
 * in `docs/firewall.md` caps one client's request rate.
 *
 * Plain ESM on raw Node request/response APIs — see `api/health.mjs` for why.
 *
 * The answer is streamed, so this function has to be allowed to live as long
 * as a long answer takes, and no longer: `vercel.json` gives it its own
 * `maxDuration` (see `docs/deploy-client-vercel.md` on why the number is
 * what it is), and a client that goes away aborts the upstream request
 * rather than leaving the invocation to burn tokens nobody will read.
 */

import {
  readJson,
  warnAboutMissingObservabilityIds,
  withObservability,
} from "../src/features/api/server.mjs";
import {
  isAllowedOrigin,
  missingConfig,
  readSession,
  SIGNED_OUT_REASON,
} from "../src/features/auth/server.mjs";
import { agentEnv } from "../src/shared/config/server-env.mjs";

/** Request fields forwarded upstream; everything else is the server's to decide */
const FORWARDED = ["messages", "tools", "tool_choice"];

/**
 * The configured upstream, or `null` when this deployment has no key.
 *
 * The key alone enables the rail; {@link agentEnv} defaults the rest. A fork
 * with no key of its own gets the panel reporting the default backend as
 * unavailable.
 *
 * `AGENT_BASE_URL` is used as given: a base with no trailing slash and no
 * `/chat/completions`, the path this appends.
 */
const upstream = () => {
  const agent = agentEnv();
  if (!agent.API_KEY) return null;

  return {
    url: `${agent.BASE_URL}/chat/completions`,
    model: agent.MODEL,
    reasoningEffort: agent.REASONING_EFFORT,
    apiKey: agent.API_KEY,
  };
};

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

/**
 * Copy the upstream's event stream to the client until either end stops.
 *
 * The 200 and the SSE headers are already sent by the time this runs, so
 * everything it has to say has to go inside the stream: ending quietly
 * on a failure would let a half-finished answer pass for a complete one.
 *
 * @param res the response, already committed
 * @param body the upstream's web stream
 */
const pipeStream = async (res, body) => {
  const reader = body.getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Nobody left to write to: the caller's `close` handler has already
      // aborted the upstream, and writing on a dead socket is a no-op
      if (res.destroyed || res.writableEnded) break;

      // A full write buffer means the client is slower than the upstream.
      // A socket that goes away mid-wait never drains, so `close` has to
      // be able to end the wait too -- otherwise the invocation parks
      // here until the platform's duration cap kills it.
      if (!res.write(value)) {
        await new Promise((resolve) => {
          const settle = () => {
            res.off("drain", settle);
            res.off("close", settle);
            resolve();
          };
          res.once("drain", settle);
          res.once("close", settle);
        });
      }
    }
  } catch (e) {
    if (!res.writableEnded && !res.destroyed) {
      // The error frame `@ai-sdk/openai-compatible` reads; `runTurn` (shared/lib/ai) raises it as `AiTurnError`
      const message = `Upstream stream failed: ${e.message}`;
      // The leading blank line closes whatever frame the upstream left
      // unfinished; glued onto it, the error would be one malformed line
      // the panel skips
      res.write(`\n\ndata: ${JSON.stringify({ error: { message } })}\n\n`);
    }
  } finally {
    await reader.cancel().catch(() => {});
    if (!res.writableEnded) res.end();
  }
};

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
async function handler(req, res) {
  warnAboutMissingObservabilityIds();
  const configured = upstream();

  // Discovery, mirroring `api/mcp.mjs`: the client asks whether this
  // deployment has a default backend rather than assuming one. Without sign-in
  // the POST below refuses every turn, so it counts as none. The model is named
  // so the panel can show what answered; the key never leaves here. Settings
  // only, not `getAuth`: building auth opens the pool, which can throw.
  if (req.method === "GET") {
    const served = !!configured && missingConfig().length === 0;
    return sendJson(res, 200, {
      configured: served,
      model: served ? configured.model : null,
    });
  }

  if (req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return sendJson(res, 405, {
      error: "Use GET to check availability, POST to take a turn.",
    });
  }

  if (!configured) {
    return sendJson(res, 503, {
      error:
        "No default backend on this deployment. Pick another backend and " +
        "supply your own key.",
    });
  }

  // Every refusal comes before the body is read and the upstream dialled, so a
  // refused turn spends nothing. Unconfigured sign-in fails closed: with no way
  // to tell a user from anyone else, nobody spends the key.
  if (!isAllowedOrigin(req)) {
    return sendJson(res, 403, { error: "Cross-origin request refused" });
  }
  const session = await readSession(req);
  if (session.status === "unconfigured") {
    return sendJson(res, 503, {
      error:
        "Sign-in is not configured on this deployment, so its default " +
        "backend is off. Pick another backend and supply your own key.",
    });
  }
  if (session.status === "unavailable") {
    return sendJson(res, 503, {
      error: "Sign-in is unavailable right now. Try again shortly.",
    });
  }
  if (session.status === "signed-out") {
    return sendJson(res, 401, {
      error: "Sign in with GitHub to use the default backend.",
      reason: SIGNED_OUT_REASON,
    });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return sendJson(res, 400, {
      error: `Malformed request body: ${e.message}`,
    });
  }

  if (!Array.isArray(body.messages) || !body.messages.length) {
    return sendJson(res, 400, {
      error: "`messages` must be a non-empty array.",
    });
  }

  // A browser that closes the tab should not keep paying for tokens
  // nobody will read: closing the response aborts the upstream request,
  // which is also what ends `pipeStream`'s read loop. Fires on a normal
  // end too, by which point the fetch has already settled.
  const abortUpstream = new AbortController();
  res.on("close", () => abortUpstream.abort());

  let response;
  try {
    response = await fetch(configured.url, {
      method: "POST",
      signal: abortUpstream.signal,
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${configured.apiKey}`,
      },
      body: JSON.stringify({
        ...Object.fromEntries(
          FORWARDED.filter((field) => field in body).map((field) => [
            field,
            body[field],
          ])
        ),
        model: configured.model,
        reasoning_effort: configured.reasoningEffort,
        stream: true,
      }),
    });
  } catch (e) {
    return sendJson(res, 502, { error: `Upstream unreachable: ${e.message}` });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    // Our key was refused: relayed, it would read as this route refusing the caller
    if (response.status === 401 || response.status === 403) {
      console.error("agent: upstream refused the key", {
        status: response.status,
        body: text.slice(0, 300),
      });
      return sendJson(res, 502, {
        error: `The default backend's key was refused upstream (${response.status}).`,
      });
    }
    // The upstream's own status, so a 429 still reads as a 429 in the panel
    return sendJson(res, response.status, {
      error: `Upstream ${response.status}: ${text.slice(0, 300)}`,
    });
  }

  // A success with nothing to stream (a 204, say) is the upstream's
  // fault, not an answer: relaying its status would put a body on one
  // that cannot carry it
  if (!response.body) {
    return sendJson(res, 502, {
      error: `Upstream ${response.status} with no body to stream.`,
    });
  }

  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache, no-transform");
  await pipeStream(res, response.body);
}

export default withObservability("agent", handler);
