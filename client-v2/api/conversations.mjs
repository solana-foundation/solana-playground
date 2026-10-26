/**
 * Conversation sync.
 *
 * Deliberately plain ESM using raw Node request/response APIs, like the rest
 * of `api/` -- see `api/health.mjs` for why.
 */
import { validate as isUuid } from "uuid";

import { isAllowedOrigin, requireUser } from "../src/features/auth/server.mjs";
import {
  warnAboutMissingObservabilityIds,
  withObservability,
} from "../src/features/api/server.mjs";
import {
  appendMessages,
  DELETED_REASON,
  getThread,
  isEnabled,
  listMessages,
  listThreads,
  NotYours,
  ThreadDeleted,
} from "../src/features/persistence/server.mjs";
import { createServerLogger } from "../src/shared/lib/logger/server.mjs";

const log = createServerLogger("api:conversations");

/** Anything larger is not a conversation batch, it is an attack or a bug */
const MAX_BODY_BYTES = 2_000_000;
const MAX_ITEMS = 500;

/** Long enough for a sentence lifted off the first message, no longer */
const MAX_TITLE = 200;

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

/**
 * The layout Postgres accepts for a `uuid`, which `appendMessages` casts every
 * item id to.
 *
 * Hex groups only, with no attempt to pin the version or variant nibbles --
 * deliberately looser than `uuid`'s own `validate`, which is why this is not
 * that. The job here is to keep a cast from throwing, not to police how an id
 * was minted: a v7 id, or one carried over from an older client, casts
 * perfectly well, and rejecting it would drop a message the database would
 * have taken. Postgres also accepts a braced or unhyphenated form; we mint our
 * own ids and never write those, so nothing is lost by not matching them.
 *
 * A `threadId` is the other question and gets the other check: that one is
 * always ours, always a v4, and `isUuid` is right for it.
 */
const CASTABLE_UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * Whether one item is something the insert can be handed.
 *
 * Every check here stands in for a cast in `appendMessages`: `v.id::uuid`,
 * `(payload ->> 'createdAt')::timestamptz`, and the same cast of `updatedAt`
 * that decides which copy of a message is newer. `updatedAt` is optional --
 * an item nobody has changed, and every item from before versions existed,
 * has none -- but one that is present has to cast. Unvalidated, a bad value
 * is a driver error escaping the route as a 500 -- for what is plainly a bad
 * request, and a reachable one: threads are stored in IndexedDB, which the
 * user can edit, and `chat-codec.isStoredItem` accepts any string for an id.
 *
 * Exported for `api/conversations.test.mjs`: the POST branch is behind the
 * auth gate, which a direct call cannot pass.
 */
export const isValidItem = (i) =>
  !!i &&
  typeof i.id === "string" &&
  CASTABLE_UUID.test(i.id) &&
  typeof i.createdAt === "string" &&
  !Number.isNaN(Date.parse(i.createdAt)) &&
  (!("updatedAt" in i) ||
    (typeof i.updatedAt === "string" &&
      !Number.isNaN(Date.parse(i.updatedAt)))) &&
  KINDS.has(i.kind);

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

/**
 * Read and parse the request body.
 *
 * Reports its two failures separately rather than through one `catch`: over
 * the cap is a 413 and unparseable JSON is a 400, and sharing a `try` made the
 * second answer the first. See `api/projects.mjs` for the longer note.
 *
 * Exported for `api/conversations.test.mjs`, which cannot pass the auth gate.
 *
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<{body: object} | {error: "too-large" | "malformed"}>}
 */
export const readBody = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return { error: "too-large" };
    chunks.push(chunk);
  }
  try {
    return { body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") };
  } catch {
    return { error: "malformed" };
  }
};

/**
 * What to answer when a write throws.
 *
 * Two failures are a client's to act on and get a status of their own. An id
 * that is somebody else's reads the same as one that does not exist:
 * confirming which would turn this route into an oracle for guessed uuids. A
 * thread deleted with its project is 410, and the distinction matters at the
 * other end: the client deletes its own copy of a thread once the server has
 * taken it, so a 2xx would lose messages, and it reads every other refusal
 * as transient, so a 404 would have it push the thread again on every turn.
 * `scope` says which tombstone it was, and the client acts on it: a thread
 * deleted under a live project is replaced on the spot; one under a deleted
 * project waits for the user's answer about the project.
 *
 * Anything else is ours, so the client gets a generic 500 and the driver's
 * own text stays server side -- it names columns, constraints and sometimes
 * values. Same shape as `describeDriverError` in `api/projects.mjs`.
 *
 * Exported for `api/conversations.test.mjs`: the write is behind the auth
 * gate, which a direct call cannot pass.
 *
 * @returns {{status: number, body: object}}
 */
export const describeFailure = (e) => {
  if (e instanceof NotYours) {
    return { status: 404, body: { error: "No such thread" } };
  }
  if (e instanceof ThreadDeleted) {
    return {
      status: 410,
      body: { error: e.message, reason: DELETED_REASON, scope: e.scope },
    };
  }
  return { status: 500, body: { error: "Sync failed" } };
};

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
async function handler(req, res) {
  warnAboutMissingObservabilityIds();
  if (!isEnabled()) return sendJson(res, 503, { error: "Sync is disabled" });

  // Ahead of the session lookup: a request from somewhere else is refused on
  // its own terms, whoever it turns out to be signed in as.
  if (req.method !== "GET" && !isAllowedOrigin(req)) {
    return sendJson(res, 403, { error: "Cross-origin request refused" });
  }

  const user = await requireUser(req);
  if (!user) return sendJson(res, 401, { error: "Not signed in" });

  const url = new URL(req.url, "http://localhost");

  // One `try` around both branches that reach the database: without it a
  // driver error is an unhandled rejection on the platform rather than a
  // response. `describeFailure` names the failures that map to a status of
  // their own; anything else either conflicts harmlessly, which the
  // versioned `on conflict` already absorbs, or fails for a reason no client
  // can act on, so a generic 500 is the honest answer.
  try {
    if (req.method === "GET") {
      const threadId = url.searchParams.get("threadId");
      const projectId = url.searchParams.get("projectId");

      // One thread with its messages
      if (threadId) {
        if (!isUuid(threadId)) {
          return sendJson(res, 400, { error: "threadId must be a uuid" });
        }
        const thread = await getThread(user.id, threadId);
        if (!thread) return sendJson(res, 404, { error: "No such thread" });
        return sendJson(res, 200, {
          thread,
          items: await listMessages(user.id, threadId),
        });
      }

      // Every thread on a project, without their messages
      if (projectId) {
        return sendJson(res, 200, {
          threads: await listThreads(user.id, projectId),
        });
      }

      return sendJson(res, 400, { error: "threadId or projectId required" });
    }

    if (req.method === "POST") {
      const read = await readBody(req);
      if (read.error === "too-large") {
        return sendJson(res, 413, {
          error: `A batch must be under ${MAX_BODY_BYTES} bytes`,
          reason: "too-large",
        });
      }
      if (read.error) return sendJson(res, 400, { error: "Body must be JSON" });

      const { threadId, projectId, title, items } = read.body;
      if (typeof threadId !== "string" || !isUuid(threadId)) {
        return sendJson(res, 400, { error: "threadId must be a uuid" });
      }
      if (typeof projectId !== "string" || !projectId) {
        return sendJson(res, 400, { error: "projectId required" });
      }
      if (!Array.isArray(items)) {
        return sendJson(res, 400, { error: "items required" });
      }
      if (
        title != null &&
        (typeof title !== "string" || title.length > MAX_TITLE)
      ) {
        return sendJson(res, 400, { error: "Malformed title" });
      }

      if (items.length > MAX_ITEMS) {
        return sendJson(res, 413, {
          error: `At most ${MAX_ITEMS} items`,
          reason: "too-large",
        });
      }
      if (!items.every(isValidItem)) {
        return sendJson(res, 400, { error: "Malformed items" });
      }

      return sendJson(res, 200, {
        written: await appendMessages(
          user.id,
          { threadId, projectId, title: title ?? null },
          items
        ),
      });
    }
  } catch (e) {
    const { status, body } = describeFailure(e);
    // Only the generic branch is a surprise, and its text is the half that
    // must not travel: driver messages name columns, constraints and values.
    if (status === 500) {
      log.error(e, {
        report: true,
        context: {
          code: e?.code,
          constraint: e?.constraint,
          statement: e?.statement,
        },
      });
    }
    return sendJson(res, status, body);
  }

  return sendJson(res, 405, { error: "Method not allowed" });
}

export default withObservability("conversations", handler);
