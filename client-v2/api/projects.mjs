/**
 * Project snapshot sync.
 *
 * Deliberately plain ESM using raw Node request/response APIs, like the rest
 * of `api/` -- see `api/health.mjs` for why. `sendJson` and `readBody` are
 * duplicated in `api/conversations.mjs` on purpose: copying two short functions
 * is cheaper than a shared module. `isAllowedOrigin` comes from the auth slice,
 * because every route acting for a signed-in user needs it and its reasoning is
 * long.
 */
import { isAllowedOrigin, requireUser } from "../src/features/auth/server.mjs";
import {
  warnAboutMissingObservabilityIds,
  withObservability,
} from "../src/features/api/server.mjs";
import {
  deleteProject,
  getProject,
  isEnabled,
  listProjects,
  saveProject,
} from "../src/features/persistence/server.mjs";
import { createServerLogger } from "../src/shared/lib/logger/server.mjs";

const log = createServerLogger("api:projects");

/**
 * A workspace larger than this is not something we sync silently.
 *
 * Ours, not the platform's. Vercel Functions accept a request body of up to
 * 100 MB, so this sits well under the cap and is a product decision about what
 * a reasonable workspace is -- written down because the figure has already
 * been re-derived once from the old 4.5 MB limit and judged, wrongly, to be
 * over it. Nothing here needs to change if that platform number moves.
 *
 * The rejection carries `reason: "too-large"` for the same reason the name
 * collision below carries one: the client files every failure it cannot name
 * under a silent "skipped", so a workspace that is genuinely too big has to
 * arrive as something it can tell apart and say out loud.
 */
const MAX_BODY_BYTES = 8_000_000;

/** Matches `projects_kind_check`, so a bad kind is a 400 and not a 500 */
const KINDS = ["project", "tutorial"];

/** A map of non-empty paths to string contents */
const isFileMap = (value) =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.entries(value).every(
    ([path, content]) => path.length > 0 && typeof content === "string"
  );

/**
 * Which of the two write shapes a body is, or why it is neither.
 *
 * Checked on the way *in* because the read side is destructive: restoring a
 * project replaces the workspace's files with what the row holds, so a row
 * that is not a clean file map empties that project on every device that
 * syncs it.
 *
 * - `files`: the whole set. Refused when empty -- a full write replaces the
 *   file set, so an empty one would delete every file, and no editor ever has
 *   a reason to send it (`pushCurrent` already refuses to build one).
 * - `changed` + `removed`: a patch against the state `baseUpdatedAt` names.
 *   Without a token there is nothing for it to be relative to.
 *
 * `force` is refused outright. There is no unconditional overwrite any more:
 * two devices' copies are merged on the client, so every write is either a
 * create or a swap against the row the caller read.
 *
 * Exported for `api/projects.test.mjs`: the handler is behind the auth gate.
 *
 * @returns {{files: Record<string, string>}
 *   | {changed: Record<string, string>, removed: string[]}
 *   | {error: string}}
 */
export const describeWrite = (body) => {
  if (body.force !== undefined) return { error: "force is not supported" };
  const full = body.files !== undefined;
  const patch = body.changed !== undefined || body.removed !== undefined;
  if (full === patch) {
    return { error: "Send either files, or changed and removed" };
  }

  if (full) {
    return isFileMap(body.files) && Object.keys(body.files).length
      ? { files: body.files }
      : { error: "files must be a non-empty map of paths to strings" };
  }

  if (!body.baseUpdatedAt) {
    return { error: "A patch needs baseUpdatedAt" };
  }
  const changed = body.changed ?? {};
  const removed = body.removed ?? [];
  if (!isFileMap(changed)) {
    return { error: "changed must be a map of paths to strings" };
  }
  if (
    !Array.isArray(removed) ||
    !removed.every((path) => typeof path === "string" && path.length > 0)
  ) {
    return { error: "removed must be a list of paths" };
  }
  if (removed.some((path) => path in changed)) {
    return { error: "A path cannot be both changed and removed" };
  }
  return { changed, removed };
};

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

/**
 * Read and parse the request body.
 *
 * Reports the two ways it can fail separately, rather than throwing both into
 * one `catch`. They used to share a `try`, which made a JSON syntax error --
 * a 400 by any reading -- answer 413, telling a client to shrink a body whose
 * size was never the problem. A returned result rather than a thrown error
 * because the caller has to branch on which one happened anyway.
 *
 * Exported for `api/projects.test.mjs`: the handler itself is behind the auth
 * gate, which a direct call cannot pass.
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
 * What to answer when the driver throws.
 *
 * Only one driver error is a client's fault rather than ours. `23505` on
 * `projects_user_name_idx` -- `unique (user_id, name) where deleted_at is
 * null` -- means the account already has a live project under this name, and
 * `pushCurrent` sends whatever the local workspace is called, so two local
 * workspaces that resolve to the same name collide on the first reconcile.
 *
 * It answers 409 **without** `conflict: true`, and the omission is the whole
 * point. The client branches on `body.conflict === true`, not on the status:
 * a bare 409 reads to it as "this project diverged" and raises a banner asking
 * the user to keep this version or take the other, which is not a question
 * about a name and has no answer. `reason` is the discriminator that lets it
 * tell a collision from a divergence before it decides which banner to raise.
 * The client half of this is written elsewhere; the contract is this shape.
 *
 * Anything else is ours, so the client gets a generic 500 and the driver's own
 * text stays server side -- it names columns, constraints and sometimes values.
 *
 * Exported for `api/projects.test.mjs`, which feeds it a `23505` raised by a
 * real database so the code this keys on cannot drift from the code Postgres
 * sends.
 *
 * @returns {{status: number, body: object}}
 */
export const describeDriverError = (e) => {
  if (e?.code === "23505") {
    return {
      status: 409,
      body: {
        error: "A project with this name already exists in your account",
        reason: "name-taken",
      },
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
  const id = url.searchParams.get("id");

  // One `try` around every branch that reaches the database, rather than one
  // per call. Without it a driver error is an unhandled rejection on the
  // platform, which the client sees as a bodiless 500 it cannot tell from a
  // network failure -- and `push` files any such answer under a silent
  // "skipped", so the project simply stops syncing.
  try {
    if (req.method === "GET") {
      if (!id) {
        return sendJson(res, 200, { projects: await listProjects(user.id) });
      }
      const project = await getProject(user.id, id);
      return project
        ? sendJson(res, 200, { project })
        : sendJson(res, 404, { error: "Not found" });
    }

    if (req.method === "PUT") {
      const read = await readBody(req);
      if (read.error === "too-large") {
        return sendJson(res, 413, {
          error: `A workspace upload must be under ${MAX_BODY_BYTES} bytes`,
          reason: "too-large",
        });
      }
      if (read.error) return sendJson(res, 400, { error: "Body must be JSON" });
      const { body } = read;

      if (
        typeof body.id !== "string" ||
        typeof body.name !== "string" ||
        !KINDS.includes(body.kind)
      ) {
        return sendJson(res, 400, { error: "id, name and kind required" });
      }

      const write = describeWrite(body);
      if (write.error) return sendJson(res, 400, { error: write.error });

      // Reaches SQL as a timestamptz. Unchecked, a malformed one is a cast
      // error from the driver, which is a 500 for what is really a bad request.
      if (
        body.baseUpdatedAt !== undefined &&
        (typeof body.baseUpdatedAt !== "string" ||
          Number.isNaN(Date.parse(body.baseUpdatedAt)))
      ) {
        return sendJson(res, 400, {
          error: "baseUpdatedAt must be a timestamp",
        });
      }

      // Named fields rather than the body passed through, so nothing a client
      // adds reaches the write without this handler having checked it
      const result = await saveProject(user.id, {
        id: body.id,
        name: body.name,
        kind: body.kind,
        baseUpdatedAt: body.baseUpdatedAt,
        ...write,
      });
      return result.conflict
        ? sendJson(res, 409, result)
        : sendJson(res, 200, result);
    }

    if (req.method === "DELETE") {
      if (!id) return sendJson(res, 400, { error: "id required" });
      await deleteProject(user.id, id);
      return sendJson(res, 200, { deleted: true });
    }
  } catch (e) {
    const { status, body } = describeDriverError(e);
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

export default withObservability("projects", handler);
