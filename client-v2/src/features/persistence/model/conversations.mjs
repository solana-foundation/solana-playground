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
import { CHAT_LIMIT_ORDER, CHAT_LIMITS } from "./chat-limits.mjs";
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

/**
 * A push whose project id names no project row of the account.
 *
 * A push used to insert that row, so a client could mint any number of
 * project rows outside the project cap, which counts only rows holding files
 * (HOO-2882). A project row now comes only from `PUT /api/projects`. Its own
 * type so the route can answer 409 `no-project`: the client keeps the thread
 * and pushes it again once its project is accepted.
 */
export class NoProject extends Error {
  constructor() {
    super("No such project");
    this.name = "NoProject";
  }
}

/**
 * A push that would take the account past a cap in `CHAT_LIMITS`. `limit` is
 * the refusal's body: which cap, its figure, and the measure the push would
 * have made.
 */
export class OverChatLimit extends Error {
  /** @param {import("./chat-limits.mjs").ChatLimitExceeded} limit */
  constructor(limit) {
    super(`Over the account's conversation cap: ${limit.reason}`);
    this.name = "OverChatLimit";
    this.limit = limit;
  }
}

/**
 * Serialises one account's pushes, so two that race at the cap cannot each
 * measure the other's absence and both pass. Transaction-scoped. A statement
 * of its own, before the first `MEASURE`: under READ COMMITTED a statement's
 * snapshot is taken when it starts, so a measure in the same statement would
 * read from before the wait.
 *
 * Taken first, before any row lock: `deleteProject` locks rows and never this,
 * so nothing holding a row ever waits here. Not the project cap's key
 * (`projects-cap:` in `projects.mjs`): a push and a project write of one
 * account do not need to queue behind each other.
 */
const LOCK_ACCOUNT = `
  select pg_advisory_xact_lock(hashtextextended('conversations-cap:' || $1, 0))`;

/**
 * The account's three measures, over its live conversations. A deleted
 * conversation has had its messages erased (`deleteProject`), so only the
 * thread count needs the filter, and the join keeps the other two honest
 * should one survive. `messages_bytes_idx` and `conversations_user_live_idx`
 * keep it to index scans: no payload is read.
 */
const MEASURE = `
  select (select count(*) from conversations
           where user_id = $1 and deleted_at is null)::int as threads,
         count(m.conversation_id)::int as messages,
         coalesce(sum(m.bytes), 0)::bigint as bytes
    from conversations c
    join messages m on m.conversation_id = c.id
   where c.user_id = $1 and c.deleted_at is null`;

const measure = async (client, userId) => {
  const { rows } = await run(client, MEASURE, [userId]);
  return { ...rows[0], bytes: Number(rows[0].bytes) };
};

/**
 * Throw `OverChatLimit` for the first cap, in `CHAT_LIMIT_ORDER`, that the
 * push took the account past. Only a measure the push grew can refuse it: a
 * push that grows none, such as a re-push of stored messages, goes through
 * even when the account already holds more than a cap (one lowered since).
 */
const refuseOverLimitWith = (limits) => (before, after) => {
  for (const [reason, key] of CHAT_LIMIT_ORDER) {
    if (after[key] > limits[key] && after[key] > before[key]) {
      throw new OverChatLimit({
        reason,
        limit: limits[key],
        count: after[key],
      });
    }
  }
};

/** Columns a thread listing returns. Never the messages. */
const THREAD_COLUMNS = `id, project_id as "projectId", title,
  created_at as "createdAt", updated_at as "updatedAt"`;

/**
 * Ensure the thread row exists, is this user's, and is live, under a live
 * project row of this user's.
 *
 * The insert is `on conflict (id) do nothing` rather than an upsert: a thread
 * row is identity, not state, and every push after the first would otherwise
 * rewrite it for no gain. What each turn ran on is on the messages, in
 * `payload.origin`. Messages are the other way round: they are state, and
 * `appendMessages` replaces one when a newer copy arrives.
 *
 * The project row is read, never created (HOO-2882): a push that created it
 * let a client mint project rows outside the project cap. Read before the
 * thread is inserted, because a thread row created beneath a tombstone would
 * be a live thread on a dead project, which the next list by project hands
 * out as the account's conversation.
 *
 * @param {import("pg").PoolClient} client
 * @param {{threadId: string, projectId: string, title?: string|null}} thread
 * @returns {Promise<string>} the thread id
 * @throws {NoProject} when the account has no row for the project
 * @throws {NotYours} when the id is already somebody else's thread
 * @throws {ThreadDeleted} when the project, or the thread, was deleted
 */
const ensureThread = async (client, userId, thread) => {
  const { threadId, projectId, title = null } = thread;

  // `(user_id, id)`, not `id`: a tutorial's id is derived, so every user who
  // starts the same one produces the same string.
  //
  // `for share` holds the row until this push commits, and `deleteProject`
  // updates that row first. So a delete either waits for the push and then
  // erases what it wrote, or lands first and the push, re-reading the row
  // once the delete commits, is refused. Unlocked, a push that passed this
  // check could write its messages after the delete had erased the thread.
  const { rows: project } = await run(
    client,
    `select deleted_at from projects where user_id = $2 and id = $1
        for share`,
    [projectId, userId]
  );
  if (!project.length) throw new NoProject();
  if (project[0].deleted_at) throw new ThreadDeleted("project");

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
 * The account is measured before and after, under a per-account lock, and a
 * push that takes it past a cap in `CHAT_LIMITS` is rolled back whole
 * (HOO-2882): what the account stored before it stays.
 *
 * @param {{threadId: string, projectId: string, title?: string|null}} thread
 * `appendMessagesWith(limits)` takes other caps, for tests, which cannot
 * fill 20,000 messages per case; `appendMessages` holds the real ones.
 *
 * @returns {Promise<number>} how many rows were written: inserted, or
 * replaced by a newer copy. A copy that lost to the stored one is not counted.
 * @throws {NoProject} when the account has no row for the project
 * @throws {NotYours} when the thread id is somebody else's
 * @throws {ThreadDeleted} when the thread, or its project, was deleted
 * @throws {OverChatLimit} when the push takes the account past a cap
 */
export const appendMessagesWith = (limits) => async (userId, thread, items) => {
  const client = await (await getPool()).connect();
  try {
    await client.query("begin");
    await run(client, LOCK_ACCOUNT, [userId]);
    const before = await measure(client, userId);
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
    refuseOverLimitWith(limits)(before, await measure(client, userId));
    await client.query("commit");
    return rowCount;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
};

/** `appendMessagesWith` under the account caps in `CHAT_LIMITS` */
export const appendMessages = appendMessagesWith(CHAT_LIMITS);
