/**
 * Conversation reads and writes.
 *
 * Every statement is scoped by `user_id`, in the statement itself rather than
 * in a caller's check: a route that forgets the guard then returns nothing
 * instead of returning someone else's thread.
 *
 * A thread is identified by its own id, minted on the client like every
 * message id. That is what lets a project hold more than one conversation,
 * and what makes a repeated push a no-op rather than a second thread.
 */
import { getPool, query, run } from "./db.mjs";
import { isDeletedScope } from "./deleted.mjs";

/**
 * A thread id that exists but belongs to somebody else.
 *
 * Its own type so the route can answer 404 -- the same answer as an id that
 * does not exist at all, which is what a client guessing at uuids should be
 * told either way.
 */
export class NotYours extends Error {
  constructor() {
    super("No such thread");
    this.name = "NotYours";
  }
}

/**
 * A thread that was deleted with its project, or a project that was.
 *
 * Refused rather than written to: every read filters a tombstoned thread
 * out, so messages accepted here could never be read back by any device --
 * and a client deletes its own copy of a thread once the server has taken
 * it. Its own type so the route can answer 410: a 404 is what a guessed id
 * gets, and the client reads every refusal but a 410 as transient and
 * pushes the thread again on every turn, against a tombstone that never
 * lifts.
 *
 * `scope` says which tombstone refused it, because the client acts
 * differently on each: a thread deleted under a live project (a tutorial
 * started again elsewhere) is replaced by a new one on the spot, while a
 * thread under a deleted project waits for the user's answer about the
 * project -- "keep as new" carries the conversation, "delete" drops it.
 */
export class ThreadDeleted extends Error {
  /** @param {"project" | "thread"} scope which tombstone refused the write */
  constructor(scope) {
    // Checked here because `scope` goes on the wire, and the client acts on
    // `thread` by dropping its copy: a misspelling must fail the server, not
    // fall through to either branch
    if (!isDeletedScope(scope)) {
      throw new TypeError(`ThreadDeleted: unknown scope ${String(scope)}`);
    }
    super(scope === "project" ? "Project was deleted" : "Thread was deleted");
    this.name = "ThreadDeleted";
    this.scope = scope;
  }
}

/** Columns a thread listing returns. Never the messages. */
const THREAD_COLUMNS = `id, project_id as "projectId", title,
  created_at as "createdAt", updated_at as "updatedAt"`;

/**
 * Ensure the project row and the thread row exist, are this user's, and are
 * live.
 *
 * The insert is `on conflict (id) do nothing` rather than an upsert: a thread
 * row is identity, not state, and every push after the first would otherwise
 * rewrite it for no gain. What each turn ran on is on the messages, in
 * `payload.origin`. Messages are the other way round: they are state, and
 * `appendMessages` replaces one when a newer copy arrives.
 *
 * The project is checked before the thread is inserted. Its insert is
 * `do nothing` too, so a tombstone stays one -- and a thread row created
 * beneath it would be a live thread on a dead project, which the next list
 * by project hands out as the account's conversation. An ordering, not a
 * lock: under READ COMMITTED a `deleteProject` committing between the two
 * statements still leaves such a thread, and the next push to it is what
 * tells the device.
 *
 * @param {import("pg").PoolClient} client
 * @param {{threadId: string, projectId: string, title?: string|null}} thread
 * @returns {Promise<string>} the thread id
 * @throws {NotYours} when the id is already somebody else's thread
 * @throws {ThreadDeleted} when the project, or the thread, was deleted
 */
const ensureThread = async (client, userId, thread) => {
  const { threadId, projectId, title = null } = thread;
  const kind = projectId.startsWith("tut:") ? "tutorial" : "project";

  // `(user_id, id)`, not `id`: a tutorial's id is derived, so every user who
  // starts the same one produces the same string.
  //
  // The select reads the statement's snapshot, which is from before the
  // insert: no row means the insert just made one, which is live.
  const { rows: project } = await run(
    client,
    `with ensured as (
       insert into projects (id, user_id, name, kind)
       values ($1, $2, $1, $3)
       on conflict (user_id, id) do nothing
     )
     select deleted_at from projects where user_id = $2 and id = $1`,
    [projectId, userId, kind]
  );
  if (project[0]?.deleted_at) throw new ThreadDeleted("project");

  await run(
    client,
    `insert into conversations (id, user_id, project_id, title)
     values ($1, $2, $3, $4)
     on conflict (id) do nothing`,
    [threadId, userId, projectId, title]
  );

  // The insert above is silent when the id is taken, and a uuid can be
  // guessed. Without this read the next statement would append a stranger's
  // messages to a stranger's thread. Ownership first, then liveness: whether
  // a stranger's thread was deleted is not this caller's to learn.
  const { rows } = await run(
    client,
    `select id, deleted_at from conversations where id = $1 and user_id = $2`,
    [threadId, userId]
  );
  if (!rows.length) throw new NotYours();
  if (rows[0].deleted_at) throw new ThreadDeleted("thread");

  return rows[0].id;
};

/**
 * One thread's row, without its messages.
 *
 * @returns {Promise<object|null>}
 */
export const getThread = async (userId, threadId) => {
  const { rows } = await query(
    `select ${THREAD_COLUMNS} from conversations
      where id = $1 and user_id = $2 and deleted_at is null`,
    [threadId, userId]
  );
  return rows[0] ?? null;
};

/**
 * Every live thread on one project, newest first.
 *
 * Deliberately without messages: this is what a browser that has never seen
 * the account reads to decide which thread to open, and downloading every
 * transcript to answer that would cost the whole history.
 *
 * @returns {Promise<object[]>}
 */
export const listThreads = async (userId, projectId) => {
  const { rows } = await query(
    `select ${THREAD_COLUMNS} from conversations
      where user_id = $1 and project_id = $2 and deleted_at is null
      order by updated_at desc`,
    [userId, projectId]
  );
  return rows;
};

/**
 * Read one thread in order.
 *
 * @returns {Promise<object[]>} stored chat items, oldest first
 */
export const listMessages = async (userId, threadId) => {
  const { rows } = await query(
    `select m.payload
       from messages m
       join conversations c on c.id = m.conversation_id
      where c.id = $1 and c.user_id = $2 and c.deleted_at is null
      order by m.created_at, m.id`,
    [threadId, userId]
  );
  return rows.map((row) => row.payload);
};

/**
 * An item's version: when it last changed, or when it was made.
 *
 * The JS twin of `VERSION_OF` below, for choosing between two copies of one id
 * inside a single batch.
 */
const versionOf = (item) => Date.parse(item.updatedAt ?? item.createdAt);

/**
 * The same, in SQL, for a `payload` column of the given row -- with `cast`
 * applied to the column first when it is not `jsonb` yet.
 *
 * Cast and compared as `timestamptz`, not as text: two spellings of one
 * instant -- a different offset, or no milliseconds -- would otherwise read
 * as one being newer and rewrite the row for nothing.
 */
const VERSION_OF = (row, cast = "") =>
  `coalesce(${row}.payload${cast} ->> 'updatedAt', ${row}.payload${cast} ->> 'createdAt')::timestamptz`;

/**
 * Write items to a thread, creating it if this is its first push.
 *
 * An item is not immutable once pushed. A reply streams into an item that
 * already exists, and an approval is answered and given an outcome later, so
 * a push can carry a newer copy of an id the server already holds. The newer
 * one replaces the older, by `updatedAt ?? createdAt`; an equal or older copy
 * writes nothing. Insert-only used to be the rule, and a reply pushed while
 * it was still streaming was then what the account kept for ever.
 *
 * Ids are minted by the client, so this is still safely repeatable: a second
 * dump of the same messages writes nothing, and neither does a stale copy
 * from a device that pulled before the turn finished. That is what lets
 * sign-in sync run unconditionally instead of exactly once.
 *
 * Repeatable *within a conversation*, which is as far as a client-minted id
 * can be trusted -- see the `on conflict` below.
 *
 * @param {{threadId: string, projectId: string, title?: string|null}} thread
 * @returns {Promise<number>} how many rows were written: inserted, or
 * replaced by a newer copy. A copy that lost to the stored one is not counted.
 * @throws {NotYours} when the thread id is somebody else's
 * @throws {ThreadDeleted} when the thread, or its project, was deleted
 */
export const appendMessages = async (userId, thread, items) => {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const conversationId = await ensureThread(client, userId, thread);

    // One copy per id, the newest. A thread can hold an id twice -- it lives
    // in IndexedDB, which the user can edit -- and `on conflict do update`
    // refuses to touch one row twice in a statement, so a duplicate would
    // fail the whole push where `do nothing` used to absorb it.
    //
    // Keyed on the lower-cased id because that is what the row is keyed on:
    // the insert casts to `uuid`, which ignores case, so two spellings of one
    // id are one row and would trip the same refusal.
    const newest = new Map();
    for (const item of items) {
      const key = item.id.toLowerCase();
      const kept = newest.get(key);
      if (!kept || versionOf(item) > versionOf(kept)) newest.set(key, item);
    }

    // Not short-circuited on an empty batch: the first push of a thread that
    // has nothing in it yet is how the row comes into being, and the panel
    // does exactly that when a workspace opens.
    let rowCount = 0;
    if (newest.size) {
      const values = [];
      const params = [];
      [...newest.values()].forEach((item, i) => {
        const at = i * 4;
        values.push(`($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4})`);
        params.push(item.id, conversationId, item.kind, JSON.stringify(item));
      });

      // `(conversation_id, id)`, not `id`: the id comes verbatim out of the
      // request body, so it is only unique within the scope that minted it.
      // Against a global key, one account posting another's id would have its
      // write dropped in silence -- and the returned count would answer
      // whether that id exists anywhere at all. Same reasoning as
      // `(user_id, id)` on `projects`, one level down. Re-dumping a thread
      // still writes nothing: a repeat carries the same conversation, and
      // the same version.
      //
      // The key is also what keeps the update inside its owner's thread:
      // `conversationId` is the one `ensureThread` has just proved is this
      // user's, so a conflict can only ever be with a row of that thread.
      // `created_at` is left as it was, because it is what orders the thread
      // and a reply finishing does not move it. Why two versions can be
      // compared at all: `mergeThreads` in `chat-codec.ts`.
      //
      // The `where` casts every incoming version up front, and is true for
      // any value that casts. Otherwise only the conflict branch cast
      // `updatedAt`, so a value `Date.parse` accepts and `timestamptz` does
      // not was stored on first insert, and every later push touching that
      // row failed.
      ({ rowCount } = await run(
        client,
        `insert into messages (id, conversation_id, kind, payload, created_at)
         select v.id::uuid, v.conversation_id::uuid, v.kind, v.payload::jsonb,
                (v.payload::jsonb ->> 'createdAt')::timestamptz
           from (values ${values.join(", ")})
                as v(id, conversation_id, kind, payload)
          where ${VERSION_OF("v", "::jsonb")} is not null
         on conflict (conversation_id, id) do update
            set payload = excluded.payload, kind = excluded.kind
          where ${VERSION_OF("excluded")} > ${VERSION_OF("messages")}`,
        params
      ));
    }

    await run(
      client,
      "update conversations set updated_at = now() where id = $1",
      [conversationId]
    );
    await client.query("commit");
    return rowCount;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
};
