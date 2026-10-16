/**
 * Project snapshot reads and writes.
 *
 * Last write wins, but only among writers that had seen the current state:
 * a client whose `baseUpdatedAt` is behind is told so instead of overwriting.
 * That is the difference between "your other device won" and "your other
 * device's work is gone".
 */
import { query, transaction } from "./db.mjs";
import { DELETED_REASON } from "./deleted.mjs";

export const listProjects = async (userId) => {
  const { rows } = await query(
    `select id, name, kind, updated_at
       from projects
      where user_id = $1 and deleted_at is null
      order by updated_at desc`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    updatedAt: r.updated_at.toISOString(),
  }));
};

/**
 * Read one project with its files.
 *
 * One statement, so the files and the `updated_at` handed back as the next
 * write's token come from the same snapshot of the database. Two reads could
 * straddle another device's write and pair its files with the older token.
 */
export const getProject = async (userId, id) => {
  const { rows } = await query(
    `select p.id, p.name, p.kind, p.updated_at,
            (select jsonb_object_agg(f.path, f.content)
               from project_files f
              where f.user_id = p.user_id and f.project_id = p.id) as files
       from projects p
      where p.user_id = $1 and p.id = $2 and p.deleted_at is null`,
    [userId, id]
  );
  if (!rows.length) return null;
  const [r] = rows;
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    // No rows is "no code yet" -- the parent row a chat turn creates
    snapshot: r.files ? { files: r.files } : null,
    updatedAt: r.updated_at.toISOString(),
  };
};

/**
 * Interpret the one row every write statement below returns.
 *
 * `written` is the new timestamp when the write landed, null when it did not;
 * `current` is what the row holds instead, which is the token the client needs
 * in order to try again. Both come back from a single statement, so they
 * cannot disagree the way two round trips can.
 *
 * `deleted` says the row that refused the write is a tombstone. Without it a
 * write to a deleted project looked exactly like one to a project that had
 * moved on, and the client asked "keep this version or take the other?" about
 * a version that no longer exists -- a question with no answer that works,
 * since there is nothing to take and keeping un-deletes it. `reason` is the
 * same discriminator `api/projects.mjs` already uses for a taken name.
 *
 * @returns {{updatedAt: string} |
 *   {conflict: true, updatedAt: string | null, reason?: "deleted"}}
 */
const settle = ({ written, current, deleted }) => {
  if (written) return { updatedAt: written.toISOString() };
  const conflict = {
    conflict: true,
    updatedAt: current ? current.toISOString() : null,
  };
  if (deleted) conflict.reason = DELETED_REASON;
  return conflict;
};

/**
 * Whether the row the write aimed at is a tombstone, in the same statement
 * as the write, so it describes the row that actually refused it. Null when
 * there is no row at all. Read from the statement's snapshot, so it is also
 * true for a tutorial tombstone the write has just restarted; `settle`
 * checks `written` first, which is what makes that harmless.
 */
const TOMBSTONED = `(select deleted_at is not null from projects
                      where user_id = $1 and id = $2)`;

/**
 * The swap: lands only if the row still holds the token the caller read.
 *
 * One statement, not an update followed by a read: between two round trips
 * another write can land, and the token handed back with the conflict would
 * already be the wrong one to retry with. The CTEs share a single snapshot, so
 * `current` is the value that was there when the swap missed.
 */
const SWAP = `
  with target as (
    select updated_at from projects
     where user_id = $1 and id = $2 and deleted_at is null
  ),
  swapped as (
    update projects
       set name = $3, kind = $4, updated_at = now()
     where user_id = $1 and id = $2 and deleted_at is null
       and updated_at = $5
    returning updated_at
  )
  select (select updated_at from swapped) as written,
         (select updated_at from target)  as current,
         ${TOMBSTONED}                    as deleted`;

/**
 * Create-only: a new row, a live row that holds no files yet, or a tutorial's
 * tombstone. The CTEs share one snapshot, so `current` is what was there when
 * the insert missed.
 *
 * `adopted` is true when the row came from the DO UPDATE branch (`xmax` is
 * non-zero there). The `not exists` below is not trustworthy on its own: a
 * writer that blocked on another's uncommitted insert has the `where`
 * re-checked against the newest row, but the subquery still reads the
 * statement's original snapshot, in which the other writer's files do not
 * exist yet. `writeProject` therefore re-checks an adoption in a new statement.
 *
 * The tutorial branch is keyed on both kinds: the one the row holds and the
 * one the write names. A personal project's id is a uuid nothing re-derives,
 * so a write naming `tutorial` at a deleted personal project is still refused.
 */
const CREATE = `
  with created as (
    insert into projects (id, user_id, name, kind, updated_at)
    values ($2, $1, $3, $4, now())
    on conflict (user_id, id) do update
      set name = excluded.name, kind = excluded.kind, updated_at = now(),
          deleted_at = null
    where (projects.deleted_at is null
           and not exists (
             select 1 from project_files f
              where f.user_id = projects.user_id and f.project_id = projects.id
           ))
       or (projects.deleted_at is not null
           and projects.kind = 'tutorial' and excluded.kind = 'tutorial')
    returning updated_at, (xmax <> 0) as adopted
  )
  select (select updated_at from created) as written,
         (select adopted from created) as adopted,
         (select updated_at from projects
           where user_id = $1 and id = $2 and deleted_at is null) as current,
         ${TOMBSTONED} as deleted`;

/**
 * Upsert files, skipping any row whose content already matches: a full write
 * resends every file, and rewriting the unchanged ones is exactly the cost
 * this table exists to avoid.
 */
const UPSERT_FILES = `
  insert into project_files (user_id, project_id, path, content)
  select $1, $2, f.key, f.value from jsonb_each_text($3::jsonb) f
  on conflict (user_id, project_id, path) do update
    set content = excluded.content
  where project_files.content is distinct from excluded.content`;

/** Read after an adoption, in a statement of its own -- see `CREATE` */
const HAS_FILES = `
  select exists(
    select 1 from project_files where user_id = $1 and project_id = $2
  ) as has_files`;

/**
 * Thrown from inside the transaction so that it rolls back, and caught by
 * `saveProject` outside it. Returning a conflict instead would commit the
 * adoption's change to the row.
 */
class AdoptionRefused extends Error {}

const DELETE_NAMED = `
  delete from project_files
   where user_id = $1 and project_id = $2 and path = any($3::text[])`;

const DELETE_OTHERS = `
  delete from project_files
   where user_id = $1 and project_id = $2 and not (path = any($3::text[]))`;

/**
 * Write a project.
 *
 * Two ways in, and a caller has to choose:
 *
 * - with `baseUpdatedAt`, a compare-and-swap. The write lands only if the row
 *   still holds the timestamp the caller read, so a device that has been away
 *   is told its write is stale rather than silently flattening whatever
 *   happened meanwhile. Postgres serialises two of these on the row lock and
 *   re-checks the predicate afterwards, so exactly one wins and the other is
 *   told about it -- assuming READ COMMITTED, the default. Under REPEATABLE
 *   READ the loser would raise a serialisation failure instead of reporting a
 *   conflict, and this would need a retry. The lock is held until commit,
 *   which is why the file writes share the transaction.
 * - without one, create-only. An existing row is reported as a conflict, not
 *   overwritten: a client that has never read cannot be allowed to win by
 *   virtue of having nothing to lose. This is also what stops a tombstoned
 *   project being resurrected by a device that never saw the delete. There
 *   are two exceptions. One is a row that holds no files -- `ensureThread`
 *   creates one so a chat turn has a parent project, so a project whose
 *   assistant was used before its first upload already exists by the time
 *   that upload arrives. Refusing it meant a project could be permanently
 *   unable to make its own first push; adopting it is safe precisely because
 *   there is no code in it to overwrite. The other is a tutorial's tombstone:
 *   a tutorial's id is derived from its name, so starting one again after
 *   deleting it can only ever arrive here, and refusing it left the restarted
 *   tutorial unable to sync at all. A tutorial is the same thing on every
 *   device, so starting it again is not the resurrection this door exists to
 *   stop. The trade is deliberate: a device holding an old run it never
 *   uploaded (started while signed out) brings that run back the same way,
 *   which keeps work rather than losing it. The run's conversations stay
 *   tombstoned either way -- bringing them back would hand the new run the
 *   old run's chat, which is what tombstoning them is for; a device still
 *   holding the old thread is told so on its next push (`ThreadDeleted`).
 *
 * A refusal says which row refused it: `reason: "deleted"` when the row is a
 * tombstone, nothing when it is a live row that has moved on. The client
 * asks the user a different question for each.
 *
 * The files are then either replaced (`files`: the whole set) or patched
 * (`changed` and `removed`: only what differs from the state the token names).
 * A patch is only ever accepted together with a token, so "what it differs
 * from" is always the row the caller read.
 *
 * @param {{id: string, name: string, kind: string, baseUpdatedAt?: string,
 *          files?: Record<string, string>,
 *          changed?: Record<string, string>, removed?: string[]}} input
 * @returns {Promise<{updatedAt: string} |
 *   {conflict: true, updatedAt: string | null, reason?: "deleted"}>}
 */
export const saveProject = async (userId, input) => {
  try {
    return await transaction((q) => writeProject(q, userId, input));
  } catch (e) {
    if (e instanceof AdoptionRefused) return e.outcome;
    throw e;
  }
};

/**
 * The statements behind `saveProject`, against a caller's `q`.
 *
 * A constant number of statements whatever the file count: every file of a
 * write travels as one `jsonb` parameter and is expanded by
 * `jsonb_each_text` inside a single upsert. A project created from a template
 * is two statements, not one per file. Exported so a test can count them.
 *
 * @param {(text: string, params?: unknown[]) => Promise<import("pg").QueryResult>} q
 */
export const writeProject = async (q, userId, input) => {
  const { id, name, kind, baseUpdatedAt, files, changed, removed } = input;
  const creating = !baseUpdatedAt;

  const { rows } = baseUpdatedAt
    ? await q(SWAP, [userId, id, name, kind, baseUpdatedAt])
    : await q(CREATE, [userId, id, name, kind]);

  const outcome = settle(rows[0]);
  if (outcome.conflict) return outcome;

  if (rows[0].adopted) {
    // A new statement gets a fresh snapshot, and the row lock this
    // transaction now holds means any earlier writer has committed, so its
    // files are visible here and were not to the adopting statement itself.
    const { rows: seen } = await q(HAS_FILES, [userId, id]);
    if (seen[0].has_files) {
      // The other writer's `updated_at` is gone -- this transaction just
      // overwrote it -- so the token is null, which only makes the client
      // read the project again.
      const refused = new AdoptionRefused();
      refused.outcome = { conflict: true, updatedAt: null };
      throw refused;
    }
  }

  if (files) {
    // A row that create-only let through has no files by definition -- it is
    // new, the empty parent a chat turn made, or a tombstone, whose files
    // went with the delete -- so there is nothing to delete and no statement
    // to spend on it
    if (!creating) await q(DELETE_OTHERS, [userId, id, Object.keys(files)]);
    await q(UPSERT_FILES, [userId, id, JSON.stringify(files)]);
  } else {
    if (removed?.length) await q(DELETE_NAMED, [userId, id, removed]);
    if (changed && Object.keys(changed).length) {
      await q(UPSERT_FILES, [userId, id, JSON.stringify(changed)]);
    }
  }
  return outcome;
};

/**
 * Tombstone a project.
 *
 * The row stays so another device's next sync sees "deleted" rather than
 * "missing" and does not push its local copy back up. Its files go: a
 * tombstone is never read back, and the name is freed from the live-rows
 * unique index by the same stroke.
 *
 * Its conversations are tombstoned with it, in the same transaction. They
 * are listed by project id, and a tutorial started again reuses its id, so a
 * conversation left live here was handed to the new run as the previous
 * run's chat. Scoped by user as well as project: a tutorial's id is the same
 * string in every account that started it.
 */
export const deleteProject = async (userId, id) => {
  await transaction(async (q) => {
    await q(
      `update projects set deleted_at = now()
        where user_id = $1 and id = $2 and deleted_at is null`,
      [userId, id]
    );
    await q(
      `delete from project_files where user_id = $1 and project_id = $2`,
      [userId, id]
    );
    await q(
      `update conversations set deleted_at = now()
        where user_id = $1 and project_id = $2 and deleted_at is null`,
      [userId, id]
    );
  });
};
