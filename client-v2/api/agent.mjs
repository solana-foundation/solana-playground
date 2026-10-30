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
 * serves no turns at all.
 *
 * **How much they spend is bounded three ways** (HOO-1751). A body over
 * `AGENT_MAX_BODY_BYTES` is refused, and every upstream request carries
 * an output limit, so a turn's worst-case cost is known before the call. The
 * ledger in `features/agent` reserves that cost against the user's daily cap
 * for their tier before the upstream is dialled, and settles it to the
 * reported usage once the response has ended. Each tier spends through its
 * own Gateway key, whose daily budget, with the team's monthly one, is the
 * ceiling that holds even when the ledger is wrong. The Vercel Firewall rate
 * limit in `docs/firewall.md` caps one client's request rate.
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
  BodyTooLarge,
  chargeFor,
  DAILY_CAP_REASON,
  learnAccountAge,
  POOL_EXHAUSTED_REASON,
  readBoundedBody,
  REFUSAL_MESSAGES,
  REFUSAL_STATUS,
  reserve,
  secondsToReset,
  settle,
  toMicro,
  usageReader,
  utcDay,
  worstCaseCost,
} from "../src/features/agent/server.mjs";
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
import { query } from "../src/features/persistence/server.mjs";
import { agentEnv } from "../src/shared/config/server-env.mjs";

/**
 * Request fields forwarded upstream; everything else is the server's to
 * decide, the output limit and `providerOptions` included
 */
const FORWARDED = ["messages", "tools", "tool_choice"];

/**
 * The `error.type` of a Gateway `402`: a budget in scope is spent, or the
 * team's credit balance is empty. Either way the tier's pool is out until a
 * reset or a person acts, which the caller reads as `pool-exhausted`.
 */
const POOL_EXHAUSTED_TYPES = [
  "quota_for_entity_exceeded",
  "insufficient_funds",
];

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
    // Without a newcomer key the pools are shared, and the per-user caps
    // still hold each tier to its own allowance
    keys: {
      established: agent.API_KEY,
      newcomer: agent.NEWCOMER_API_KEY ?? agent.API_KEY,
    },
    maxOutputTokens: agent.MAX_OUTPUT_TOKENS,
    providers: agent.PROVIDERS,
    prices: { input: agent.PRICE_INPUT, output: agent.PRICE_OUTPUT },
    maxBodyBytes: agent.MAX_BODY_BYTES,
    newcomerAgeDays: agent.NEWCOMER_AGE_DAYS,
    caps: {
      newcomer: toMicro(agent.NEWCOMER_DAILY_CAP),
      established: toMicro(agent.ESTABLISHED_DAILY_CAP),
    },
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
 * @param {(chunk: Uint8Array) => void} observe sees every chunk as it is
 *   forwarded, for the usage the ledger charges
 * @returns {Promise<boolean>} whether the upstream's stream ended with the
 *   caller still there; false when the caller left or the stream broke
 */
const pipeStream = async (res, body, observe) => {
  const reader = body.getReader();
  let finished = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        finished = !res.destroyed;
        break;
      }
      observe(value);
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
  return finished;
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

  // Every refusal comes before the upstream is dialled, so a refused turn
  // spends nothing; those about who is asking come before the body is read too.
  // Unconfigured sign-in fails closed: with no way to tell a user from anyone
  // else, nobody spends the key.
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
  let bytes;
  try {
    const read = await readBoundedBody(req, configured.maxBodyBytes);
    bytes = read.bytes;
    // `readJson` takes the text the way it takes a pre-parsed body
    body = await readJson({ body: read.body });
  } catch (e) {
    if (e instanceof BodyTooLarge)
      return sendJson(res, 413, { error: e.message });
    return sendJson(res, 400, {
      error: `Malformed request body: ${e.message}`,
    });
  }

  if (!Array.isArray(body.messages) || !body.messages.length) {
    return sendJson(res, 400, {
      error: "`messages` must be a non-empty array.",
    });
  }

  // One clock for the day the turn is reserved on, the day it settles on and
  // the `Retry-After` of a refusal
  const now = new Date();
  const turn = {
    userId: session.user.id,
    day: utcDay(now),
    amount: worstCaseCost({
      bytes,
      maxOutputTokens: configured.maxOutputTokens,
      prices: configured.prices,
    }),
  };

  // Fails closed: a ledger that cannot be read is no allowance at all
  let gate;
  try {
    gate = await reserve(query, {
      userId: turn.userId,
      day: turn.day,
      amount: turn.amount,
      newcomerAgeDays: configured.newcomerAgeDays,
      caps: configured.caps,
    });
  } catch (e) {
    console.error("agent: spend ledger unavailable", {
      message: e?.message,
      code: e?.code,
    });
    return sendJson(res, 503, {
      error: "The default backend is unavailable right now. Try again shortly.",
    });
  }

  // Until `relay` says otherwise: a turn that throws out of it may have been
  // generated, and charging the reservation never undercharges
  /** @type {import("../src/features/agent/server/ledger.mjs").TurnEnd} */
  let end = { kind: "unfinished" };
  try {
    if (!gate.admitted) {
      res.setHeader("retry-after", String(secondsToReset(now)));
      return sendJson(res, REFUSAL_STATUS[DAILY_CAP_REASON], {
        error: REFUSAL_MESSAGES[DAILY_CAP_REASON],
        reason: DAILY_CAP_REASON,
        tier: gate.tier,
      });
    }
    end = await relay(res, configured, body, gate.tier, now);
  } finally {
    // The response has ended on every path here, so none of this delays an
    // answer. Neither step throws: there is nobody left to tell.
    if (gate.admitted) {
      await settle(query, {
        userId: turn.userId,
        day: turn.day,
        reserved: turn.amount,
        charge: chargeFor(end, turn.amount, configured.prices),
      }).catch((e) =>
        // The reservation stays spent for the day: an overcharge, never an
        // undercharge
        console.error("agent: settling a turn failed", {
          message: e?.message,
          code: e?.code,
          end: end.kind,
        })
      );
    }
    if (!gate.dated) await learnAccountAge(query, turn.userId);
  }
}

/**
 * Take an admitted turn upstream and answer the caller.
 *
 * @param {import("node:http").ServerResponse} res
 * @param {NonNullable<ReturnType<typeof upstream>>} configured
 * @param {Record<string, unknown>} body the caller's request
 * @param {"newcomer" | "established"} tier picks the key
 * @param {Date} now for a refusal's `Retry-After`
 * @returns {Promise<import("../src/features/agent/server/ledger.mjs").TurnEnd>}
 *   how the turn ended, which decides its charge
 */
const relay = async (res, configured, body, tier, now) => {
  // A browser that closes the tab should not keep paying for tokens
  // nobody will read: closing the response aborts the upstream request,
  // which is also what ends `pipeStream`'s read loop. Fires on a normal
  // end too, by which point the fetch has already settled.
  const abortUpstream = new AbortController();
  res.on("close", () => abortUpstream.abort());
  // A caller who left while `reserve` waited on the database closed the
  // response before the listener above existed, so the signal never aborts:
  // nothing has been sent, and the reservation goes back
  if (res.destroyed) return { kind: "abandoned" };

  let response;
  try {
    response = await fetch(configured.url, {
      method: "POST",
      signal: abortUpstream.signal,
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${configured.keys[tier]}`,
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
        // The output half of the worst case the turn reserved, under OpenAI's
        // current name: Nous refuses `max_tokens` for GLM, and the Gateway
        // takes this one too
        max_completion_tokens: configured.maxOutputTokens,
        stream_options: { include_usage: true },
        // US-region providers that keep no data; empty for an upstream that
        // is not the Gateway
        ...(configured.providers.length
          ? { providerOptions: { gateway: { only: configured.providers } } }
          : {}),
      }),
    });
  } catch (e) {
    // The caller left before the upstream answered, so the abort is ours, and
    // the upstream may already have taken the request: charging nothing here
    // would let a caller that hangs up early spend past the cap
    if (abortUpstream.signal.aborted) return { kind: "unfinished" };
    sendJson(res, 502, { error: `Upstream unreachable: ${e.message}` });
    return { kind: "refused" };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    // Our request was refused: relayed, it would read as this route refusing
    // the caller
    if (response.status === 401 || response.status === 403) {
      const cause = refusalCause(response.status, text);
      console.error("agent: upstream refused the default backend", {
        status: response.status,
        cause,
        tier,
        body: text.slice(0, 300),
      });
      sendJson(res, 502, {
        error: `${REFUSAL_CAUSES[cause]} (${response.status}).`,
      });
      return { kind: "refused" };
    }
    if (response.status === 402 && isPoolExhausted(text)) {
      console.warn("agent: tier pool exhausted", {
        tier,
        body: text.slice(0, 300),
      });
      res.setHeader("retry-after", String(secondsToReset(now)));
      sendJson(res, REFUSAL_STATUS[POOL_EXHAUSTED_REASON], {
        error: REFUSAL_MESSAGES[POOL_EXHAUSTED_REASON],
        reason: POOL_EXHAUSTED_REASON,
        tier,
      });
      return { kind: "refused" };
    }
    // The upstream's own status, so a 429 still reads as a 429 in the panel
    sendJson(res, response.status, {
      error: `Upstream ${response.status}: ${text.slice(0, 300)}`,
    });
    return { kind: "refused" };
  }

  // A success with nothing to stream (a 204, say) is the upstream's
  // fault, not an answer: relaying its status would put a body on one
  // that cannot carry it. It was accepted, so it may have been billed.
  if (!response.body) {
    sendJson(res, 502, {
      error: `Upstream ${response.status} with no body to stream.`,
    });
    return { kind: "unfinished" };
  }

  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache, no-transform");
  const usage = usageReader();
  const finished = await pipeStream(res, response.body, usage.push);
  const reported = usage.usage();
  // Usage seen on a turn that did not finish may be a running total, not the
  // turn's: only a stream read to its end is charged what it reported
  return finished && reported
    ? { kind: "completed", usage: reported }
    : { kind: "unfinished" };
};

/**
 * What the operator must fix, by the cause of an upstream `401` or `403`.
 * A Gateway `403` has several causes besides the key, and reporting them all
 * as a refused key sends the operator after the wrong one.
 * https://vercel.com/docs/ai-gateway/faq#why-did-my-ai-gateway-request-fail
 *
 * @type {Record<RefusalCause, string>}
 */
const REFUSAL_CAUSES = {
  key: "The default backend's key was refused upstream",
  "free-tier":
    "The default backend's model is not in the Gateway's free tier; the team needs paid credits",
  "payment-method":
    "The default backend's Gateway team needs a payment method on file",
  allowlist:
    "The default backend's model or providers are outside the Gateway team's allowlist",
  unknown: "The default backend was refused upstream",
};

/**
 * Why the upstream refused the default backend, read from a `401` or `403`
 *
 * @typedef {"key" | "free-tier" | "payment-method" | "allowlist" | "unknown"} RefusalCause
 * @param {number} status `401` or `403`
 * @param {string} text the upstream's body
 * @returns {RefusalCause}
 */
const refusalCause = (status, text) => {
  // A missing, invalid or revoked key, whatever the upstream
  if (status === 401) return "key";
  let error;
  try {
    error = JSON.parse(text)?.error;
  } catch (e) {
    // Not JSON, so not the Gateway's: nothing to tell the causes apart by
    warnNotJson("refusal-cause", status, e);
    return "unknown";
  }
  const message = String(error?.message ?? "");
  if (error?.type === "customer_verification_required") {
    return "payment-method";
  }
  if (/free tier/i.test(message)) return "free-tier";
  if (/restrict|allowlist/i.test(message)) return "allowlist";
  return "unknown";
};

/**
 * Whether a `402` body is the Gateway's spent budget or empty balance
 *
 * @param {string} text the upstream's body
 */
const isPoolExhausted = (text) => {
  try {
    return POOL_EXHAUSTED_TYPES.includes(JSON.parse(text)?.error?.type);
  } catch (e) {
    // Not JSON, so not the Gateway's refusal: relayed as the upstream's 402
    warnNotJson("pool-exhausted", 402, e);
    return false;
  }
};

/**
 * Log which check could not read an upstream error body. Only the error's
 * name: V8's `SyntaxError` quotes the text it failed on, and the body is
 * logged, trimmed, where the route reports the refusal.
 *
 * @param {"refusal-cause" | "pool-exhausted"} check
 * @param {number} status
 * @param {unknown} e
 */
const warnNotJson = (check, status, e) =>
  console.warn("agent: upstream error body is not JSON", {
    check,
    status,
    error: e instanceof Error ? e.name : typeof e,
  });

export default withObservability("agent", handler);
