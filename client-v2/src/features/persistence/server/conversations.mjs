/**
 * Conversation reads and writes.
 *
 * Every statement is scoped by `user_id`, in the statement itself rather than
 * in a caller's check: a route that forgets the guard then returns nothing
 * instead of returning someone else's thread.
 */
import { getPool, query } from "./db.mjs";

/**
 * Ensure a project row and its conversation exist.
 *
 * @param {import("pg").PoolClient} client
 * @returns {Promise<string>} the conversation id
 */
const ensureConversation = async (client, userId, projectId) => {
  const kind = projectId.startsWith("tut:") ? "tutorial" : "project";

  // `(user_id, id)`, not `id`: a tutorial's id is derived, so every user who
  // starts the same one produces the same string
  await client.query(
    `insert into projects (id, user_id, name, kind)
     values ($1, $2, $1, $3)
     on conflict (user_id, id) do nothing`,
    [projectId, userId, kind]
  );

  // Newest live thread, because a project may hold several. No `on conflict`
  // to lean on -- that index is deliberately not unique any more.
  const existing = await client.query(
    `select id from conversations
      where user_id = $1 and project_id = $2 and deleted_at is null
      order by updated_at desc
      limit 1`,
    [userId, projectId]
  );
  if (existing.rows.length) return existing.rows[0].id;

  const created = await client.query(
    `insert into conversations (id, user_id, project_id)
     values (gen_random_uuid(), $1, $2)
     returning id`,
    [userId, projectId]
  );
  return created.rows[0].id;
};

/**
 * Read one thread in order.
 *
 * @returns {Promise<object[]>} stored chat items, oldest first
 */
export const listMessages = async (userId, projectId) => {
  const { rows } = await query(
    `select m.payload
       from messages m
       join conversations c on c.id = m.conversation_id
      where c.user_id = $1 and c.project_id = $2 and c.deleted_at is null
      order by m.created_at, m.id`,
    [userId, projectId]
  );
  return rows.map((row) => row.payload);
};

/**
 * Append items to a thread.
 *
 * Ids are minted by the client, so this is safely repeatable: a second dump
 * of the same messages writes nothing. That is what lets sign-in sync run
 * unconditionally instead of exactly once.
 *
 * @returns {Promise<number>} how many rows were new
 */
export const appendMessages = async (userId, projectId, items) => {
  if (!items.length) return 0;

  const client = await getPool().connect();
  try {
    await client.query("begin");
    const conversationId = await ensureConversation(client, userId, projectId);

    const values = [];
    const params = [];
    items.forEach((item, i) => {
      const at = i * 4;
      values.push(`($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4})`);
      params.push(item.id, conversationId, item.kind, JSON.stringify(item));
    });

    const { rowCount } = await client.query(
      `insert into messages (id, conversation_id, kind, payload, created_at)
       select v.id::uuid, v.conversation_id::uuid, v.kind, v.payload::jsonb,
              (v.payload::jsonb ->> 'createdAt')::timestamptz
         from (values ${values.join(", ")})
              as v(id, conversation_id, kind, payload)
       on conflict (id) do nothing`,
      params
    );

    await client.query(
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
