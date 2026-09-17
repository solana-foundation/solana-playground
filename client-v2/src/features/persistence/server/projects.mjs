/**
 * Project snapshot reads and writes.
 *
 * Last write wins, but only among writers that had seen the current state:
 * a client whose `baseUpdatedAt` is behind is told so instead of overwriting.
 * That is the difference between "your other device won" and "your other
 * device's work is gone".
 */
import { query } from "./db.mjs";

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

export const getProject = async (userId, id) => {
  const { rows } = await query(
    `select id, name, kind, snapshot, updated_at
       from projects
      where user_id = $1 and id = $2 and deleted_at is null`,
    [userId, id]
  );
  if (!rows.length) return null;
  const [r] = rows;
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    snapshot: r.snapshot,
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
 * @returns {{updatedAt: string} | {conflict: true, updatedAt: string | null}}
 */
const settle = ({ written, current }) =>
  written
    ? { updatedAt: written.toISOString() }
    : { conflict: true, updatedAt: current ? current.toISOString() : null };

/**
 * Write a snapshot.
 *
 * Three ways in, and a caller has to choose:
 *
 * - with `baseUpdatedAt`, a compare-and-swap. The write lands only if the row
 *   still holds the timestamp the caller read, so a device that has been away
 *   is told its write is stale rather than silently flattening whatever
 *   happened meanwhile. Postgres serialises two of these on the row lock and
 *   re-checks the predicate afterwards, so exactly one wins and the other is
 *   told about it -- assuming READ COMMITTED, the default. Under REPEATABLE
 *   READ the loser would raise a serialisation failure instead of reporting a
 *   conflict, and this would need a retry.
 * - without one, create-only. An existing row is reported as a conflict, not
 *   overwritten: a client that has never read cannot be allowed to win by
 *   virtue of having nothing to lose. This is also what stops a tombstoned
 *   project being resurrected by a device that never saw the delete.
 * - with `force`, an unconditional overwrite that also un-tombstones. This is
 *   the "keep my copy" the user picks after being shown the conflict, and it
 *   is deliberately something a caller has to name.
 *
 * @param {{id: string, name: string, kind: string, snapshot: object,
 *          baseUpdatedAt?: string, force?: boolean}} input
 * @returns {Promise<{updatedAt: string} | {conflict: true, updatedAt: string | null}>}
 */
export const saveProject = async (userId, input) => {
  const { id, name, kind, snapshot, baseUpdatedAt, force } = input;
  const values = [userId, id, name, kind, snapshot];

  if (force) {
    const { rows } = await query(
      `insert into projects (id, user_id, name, kind, snapshot, updated_at)
       values ($2, $1, $3, $4, $5, now())
       on conflict (user_id, id) do update
         set name = excluded.name,
             kind = excluded.kind,
             snapshot = excluded.snapshot,
             updated_at = now(),
             deleted_at = null
       returning updated_at as written, null::timestamptz as current`,
      values
    );
    return settle(rows[0]);
  }

  if (baseUpdatedAt) {
    // One statement, not an update followed by a read: between two round trips
    // another write can land, and the token handed back with the conflict
    // would already be the wrong one to retry with. The CTEs share a single
    // snapshot, so `current` is the value that was there when the swap missed.
    const { rows } = await query(
      `with target as (
         select updated_at from projects
          where user_id = $1 and id = $2 and deleted_at is null
       ),
       swapped as (
         update projects
            set name = $3, kind = $4, snapshot = $5, updated_at = now()
          where user_id = $1 and id = $2 and deleted_at is null
            and updated_at = $6
        returning updated_at
       )
       select (select updated_at from swapped) as written,
              (select updated_at from target)  as current`,
      [...values, baseUpdatedAt]
    );
    return settle(rows[0]);
  }

  const { rows } = await query(
    `with created as (
       insert into projects (id, user_id, name, kind, snapshot, updated_at)
       values ($2, $1, $3, $4, $5, now())
       on conflict (user_id, id) do nothing
       returning updated_at
     )
     select (select updated_at from created) as written,
            (select updated_at from projects
              where user_id = $1 and id = $2 and deleted_at is null) as current`,
    values
  );
  return settle(rows[0]);
};

/**
 * Tombstone a project.
 *
 * The row stays so another device's next sync sees "deleted" rather than
 * "missing" and does not push its local copy back up. The name is cleared of
 * the live-rows unique index by the same stroke, so it can be reused.
 */
export const deleteProject = async (userId, id) => {
  await query(
    `update projects set deleted_at = now(), snapshot = null
      where user_id = $1 and id = $2 and deleted_at is null`,
    [userId, id]
  );
};
