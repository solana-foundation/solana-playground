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
  MAX_PROJECT_BODY_BYTES,
  NO_FILES_REASON,
  projectKindOf,
  saveProject,
} from "../src/features/persistence/server.mjs";

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
 * The row a write names, or why it names none.
 *
 * - `name` must hold something: it is what the project list shows, and a
 *   blank one is a project no one can find or tell apart.
 * - `kind` must be the one the id stands for (`projectKindOf`). The client
 *   derives one from the other, so a mismatch is never a user's choice, and
 *   stored it is a tutorial listed as a project or the other way round.
 *
 * Exported for `api/projects.test.mjs`: the handler is behind the auth gate.
 *
 * @returns {{id: string, name: string, kind: "project" | "tutorial"}
 *   | {error: string}}
 */
export const describeProject = (body) => {
  const { id, name, kind } = body;
  if (typeof id !== "string" || !id || typeof name !== "string") {
    return { error: "id and name required" };
  }
  if (!KINDS.includes(kind)) {
    return { error: `kind must be one of ${KINDS.join(", ")}` };
  }
  if (!name.trim()) return { error: "name must not be empty" };
  if (kind !== projectKindOf(id)) {
    return { error: `kind must be ${projectKindOf(id)} for this id` };
  }
  return { id, name, kind };
};

/** A refusal of the body itself: every one is a 400 but `force: true`'s */
const refuse = (error, status = 400) => ({ error, status });

/**
 * Which write a body is, or why it is none.
 *
 * Checked on the way *in* because the read side is destructive: restoring a
 * project replaces the workspace's files with what the row holds, so a row
 * that is not a clean file map empties that project on every device that
 * syncs it.
 *
 * - `files`: the whole set. Refused when empty -- a full write replaces the
 *   file set, so an empty one would delete every file, and no editor ever has
 *   a reason to send it (the client's `push` refuses an empty snapshot).
 * - `snapshot.files`: the same, as the pre-#40 client spells it (below).
 * - `changed` + `removed`: a patch against the state `baseUpdatedAt` names.
 *   Without a token there is nothing for it to be relative to. Whether it
 *   leaves the project any files only the row can say: `saveProject` checks.
 *
 * `force: true` is refused. There is no unconditional overwrite any more:
 * two devices' copies are merged on the client, so every write is either a
 * create or a swap against the row the caller read.
 *
 * A tab left open across the #40 deploy still runs the client from before it,
 * and keeps doing so until reloaded. That client sends `{snapshot: {files},
 * baseUpdatedAt, force: false}` on every push and files every refusal except
 * 409 and 413 under a silent "skipped". So `force: false` reads as absent and
 * `snapshot` as a whole file set, which is exactly what it was then. `force:
 * true`, which that client sends only when the user answers its banner with
 * "keep this version", is a 409: the banner stays up rather than the answer
 * vanishing. It cannot be cleared until the tab is reloaded, and the body's
 * `error` saying so is not shown by that client. Both doors can go once no tab
 * from before the deploy can still be open.
 *
 * Exported for `api/projects.test.mjs`: the handler is behind the auth gate.
 *
 * @returns {{files: Record<string, string>}
 *   | {changed: Record<string, string>, removed: string[]}
 *   | {error: string, status: 400 | 409}}
 */
export const describeWrite = (body) => {
  if (body.force === true) {
    return refuse("force is not supported; reload the page to sync", 409);
  }
  if (body.force !== undefined && body.force !== false) {
    return refuse("force is not supported");
  }
  const old = body.snapshot !== undefined;
  const full = body.files !== undefined;
  const patch = body.changed !== undefined || body.removed !== undefined;
  if (Number(old) + Number(full) + Number(patch) !== 1) {
    return refuse("Send either files, or changed and removed");
  }

  if (old || full) {
    const files = old ? body.snapshot?.files : body.files;
    return isFileMap(files) && Object.keys(files).length
      ? { files }
      : refuse("files must be a non-empty map of paths to strings");
  }

  if (!body.baseUpdatedAt) {
    return refuse("A patch needs baseUpdatedAt");
  }
  const changed = body.changed ?? {};
  const removed = body.removed ?? [];
  if (!isFileMap(changed)) {
    return refuse("changed must be a map of paths to strings");
  }
  if (
    !Array.isArray(removed) ||
    !removed.every((path) => typeof path === "string" && path.length > 0)
  ) {
    return refuse("removed must be a list of paths");
  }
  if (removed.some((path) => path in changed)) {
    return refuse("A path cannot be both changed and removed");
  }
  return { changed, removed };
};

/**
 * What to answer for what `saveProject` returned.
 *
 * A write that would leave the project with no files is a 400 naming itself
 * in `reason`, not a 409. A 409 means "someone else wrote" to both clients:
 * the pre-#40 one would ask "keep this version?" about it, and the current one
 * would merge against a row that holds nothing. The current client only sends
 * such a patch against a row that is already empty -- its patches are built
 * from a non-empty snapshot -- and answers the `reason` with its whole file
 * set, which puts the files back.
 *
 * Exported for `api/projects.test.mjs`, like `describeWrite`.
 *
 * @returns {{status: number, body: object}}
 */
export const describeSaved = (result) => {
  if (result.refused === NO_FILES_REASON) {
    return {
      status: 400,
      body: {
        error: "A write must leave the project at least one file",
        reason: NO_FILES_REASON,
      },
    };
  }
  return { status: result.conflict ? 409 : 200, body: result };
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
    if (size > MAX_PROJECT_BODY_BYTES) return { error: "too-large" };
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
      // `reason` because the client files every failure it cannot name under
      // a silent "skipped", so a workspace that is genuinely too big has to
      // arrive as something it can tell apart and say out loud. The browser
      // refuses the same size before sending; this is the half for a client
      // that did not.
      if (read.error === "too-large") {
        return sendJson(res, 413, {
          error: `A workspace upload must be under ${MAX_PROJECT_BODY_BYTES} bytes`,
          reason: "too-large",
        });
      }
      if (read.error) return sendJson(res, 400, { error: "Body must be JSON" });
      const { body } = read;

      const project = describeProject(body);
      if (project.error) return sendJson(res, 400, { error: project.error });

      const write = describeWrite(body);
      if (write.error) {
        return sendJson(res, write.status, { error: write.error });
      }

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
        ...project,
        baseUpdatedAt: body.baseUpdatedAt,
        ...write,
      });
      const answer = describeSaved(result);
      // The one refusal that says something reached a state it should not
      // have: a row already empty, or a client building patches wrongly. Ids
      // only; file contents never travel to the logs.
      if (result.refused) {
        console.warn("api/projects: write refused", {
          userId: user.id,
          projectId: project.id,
          reason: result.refused,
        });
      }
      return sendJson(res, answer.status, answer.body);
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
    //
    // Field by field, because `console.error` on the platform stringifies an
    // Error to its `message` and `stack` and drops every property `pg` hangs
    // off it -- `code` and `constraint` among them, which are the two that say
    // what to do next. `statement` is added by `db.mjs`: it is the text held by
    // the module that is actually running, and a schema-shaped failure needs
    // exactly that to tell code behind the database from a database behind the
    // code. Same shape as `api/conversations.mjs`, duplicated for the reason
    // the note at the top of this file gives.
    if (status === 500) {
      console.error("api/projects:", {
        message: e.message,
        code: e.code,
        constraint: e.constraint,
        table: e.table,
        column: e.column,
        detail: e.detail,
        hint: e.hint,
        routine: e.routine,
        statement: e.statement,
        stack: e.stack,
      });
    }
    return sendJson(res, status, body);
  }

  return sendJson(res, 405, { error: "Method not allowed" });
}

export default withObservability("projects", handler);
