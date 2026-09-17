/**
 * Conversation sync.
 *
 * Deliberately plain ESM using raw Node request/response APIs, like the rest
 * of `api/` -- see `api/health.mjs` for why.
 */
import { requireUser } from "../src/features/auth/server/auth.mjs";
import {
  appendMessages,
  listMessages,
} from "../src/features/persistence/server/conversations.mjs";
import { isEnabled } from "../src/features/persistence/server/db.mjs";

/** Anything larger is not a conversation batch, it is an attack or a bug */
const MAX_BODY_BYTES = 2_000_000;
const MAX_ITEMS = 500;

/**
 * The kinds `messages_kind_check` accepts. Checked here so that a malformed
 * item is a 400 from this route rather than a constraint violation surfacing
 * as a 500 from the driver.
 */
const KINDS = new Set([
  "user",
  "assistant",
  "tool",
  "approval",
  "error",
  "notice",
]);

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

const readBody = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
export default async function handler(req, res) {
  if (!isEnabled()) return sendJson(res, 503, { error: "Sync is disabled" });

  const user = await requireUser(req);
  if (!user) return sendJson(res, 401, { error: "Not signed in" });

  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET") {
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return sendJson(res, 400, { error: "projectId required" });
    return sendJson(res, 200, {
      items: await listMessages(user.id, projectId),
    });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 413, { error: e.message });
    }

    const { projectId, items } = body;
    if (typeof projectId !== "string" || !Array.isArray(items)) {
      return sendJson(res, 400, { error: "projectId and items required" });
    }
    if (items.length > MAX_ITEMS) {
      return sendJson(res, 413, { error: `At most ${MAX_ITEMS} items` });
    }
    if (
      !items.every(
        (i) =>
          i &&
          typeof i.id === "string" &&
          typeof i.createdAt === "string" &&
          KINDS.has(i.kind)
      )
    ) {
      return sendJson(res, 400, { error: "Malformed items" });
    }

    return sendJson(res, 200, {
      written: await appendMessages(user.id, projectId, items),
    });
  }

  return sendJson(res, 405, { error: "Method not allowed" });
}
