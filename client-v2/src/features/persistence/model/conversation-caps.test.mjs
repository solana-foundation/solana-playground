import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, describe, it } from "node:test";

import {
  appendMessagesWith,
  NoProject,
  OverChatLimit,
} from "./conversations.mjs";
import { query } from "./db.mjs";

// Against a real database or not at all: what is under test is the statements
// and the measure they take, which a stub would only restate. `yarn test-api`
// loads `.env`; without a database this suite skips.
const DB = process.env.DATABASE_URL;

describe(
  "appendMessages: what one account may store (HOO-2882)",
  { skip: !DB && "DATABASE_URL not set" },
  () => {
    // Its own account: `conversations.test.mjs` runs in another process and
    // empties `test-user` before every case
    const userId = "test-user-conversation-caps";

    /** A message saying `text` */
    const say = (text) => ({
      id: randomUUID(),
      kind: "user",
      createdAt: new Date().toISOString(),
      text,
    });
    const item = () => say("hello");

    const counts = async () =>
      (
        await query(
          `select (select count(*)::int from projects where user_id = $1) as projects,
                  (select count(*)::int from conversations
                     where user_id = $1 and deleted_at is null) as threads,
                  (select count(*)::int from messages m join conversations c
                      on c.id = m.conversation_id where c.user_id = $1) as messages`,
          [userId]
        )
      ).rows[0];

    /** A project row of the account, as `PUT /api/projects` leaves one */
    const project = (id) =>
      query(
        `insert into projects (id, user_id, name, kind)
         values ($1, $2, $1, 'project')`,
        [id, userId]
      );

    /** Push `items` to a thread under `limits`, on project `p1` unless named */
    const push = ({ threadId, items, limits, projectId }) =>
      appendMessagesWith(limits)(
        userId,
        { threadId, projectId: projectId ?? "p1" },
        items
      );

    /** The caps, all roomy but the ones a case narrows */
    const caps = ({ threads, messages, bytes }) => ({
      threads: threads ?? 10,
      messages: messages ?? 10,
      bytes: bytes ?? 1_000_000,
    });

    const refusal = (promise) =>
      promise.then(
        () => assert.fail("the push was accepted"),
        (e) => e
      );

    const roomy = caps({});

    before(async () => {
      await query(
        `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         values ($1, 'Test', 'conversation-caps@example.com', false, now(), now())
         on conflict (id) do nothing`,
        [userId]
      );
    });

    beforeEach(async () => {
      // Conversations and messages go with their projects (`on delete cascade`)
      await query("delete from projects where user_id = $1", [userId]);
    });

    it("stores a push from an account under every cap", async () => {
      await project("p1");

      assert.equal(
        await push({
          threadId: randomUUID(),
          items: [item(), item()],
          limits: roomy,
        }),
        2
      );
      assert.deepEqual(await counts(), {
        projects: 1,
        threads: 1,
        messages: 2,
      });
    });

    it("refuses a project id the account has no row for, creating nothing", async () => {
      const e = await refusal(
        push({
          threadId: randomUUID(),
          items: [item()],
          limits: roomy,
          projectId: "unknown",
        })
      );

      assert.ok(e instanceof NoProject, String(e));
      assert.deepEqual(await counts(), {
        projects: 0,
        threads: 0,
        messages: 0,
      });
    });

    it("refuses a message past the message cap, keeping what was stored", async () => {
      await project("p1");
      const threadId = randomUUID();
      const limits = caps({ messages: 2 });
      await push({ threadId, items: [item(), item()], limits });

      const e = await refusal(push({ threadId, items: [item()], limits }));

      assert.ok(e instanceof OverChatLimit, String(e));
      assert.deepEqual(e.limit, {
        reason: "too-many-messages",
        limit: 2,
        count: 3,
      });
      assert.deepEqual(await counts(), {
        projects: 1,
        threads: 1,
        messages: 2,
      });
    });

    it("accepts a re-push of stored messages at the cap", async () => {
      await project("p1");
      const threadId = randomUUID();
      const stored = [item(), item()];
      const limits = caps({ messages: 2 });
      await push({ threadId, items: stored, limits });

      assert.equal(await push({ threadId, items: stored, limits }), 0);
    });

    it("accepts a push that grows nothing while the account is over a cap", async () => {
      await project("p1");
      const threadId = randomUUID();
      await push({ threadId, items: [item(), item(), item()], limits: roomy });

      // A cap lowered under an account that already holds more
      assert.equal(
        await push({ threadId, items: [], limits: caps({ messages: 1 }) }),
        0
      );
    });

    it("refuses a new thread past the thread cap, creating no row", async () => {
      await project("p1");
      const limits = caps({ threads: 1 });
      await push({ threadId: randomUUID(), items: [], limits });

      const e = await refusal(
        push({ threadId: randomUUID(), items: [], limits })
      );

      assert.ok(e instanceof OverChatLimit, String(e));
      assert.deepEqual(e.limit, {
        reason: "too-many-threads",
        limit: 1,
        count: 2,
      });
      assert.equal((await counts()).threads, 1);
    });

    it("refuses a push past the size cap", async () => {
      await project("p1");
      const threadId = randomUUID();
      await push({ threadId, items: [item()], limits: roomy });
      const { rows } = await query(
        `select sum(m.bytes)::int as bytes from messages m
           join conversations c on c.id = m.conversation_id
          where c.user_id = $1`,
        [userId]
      );
      const held = rows[0].bytes;

      const e = await refusal(
        push({
          threadId,
          items: [say("x".repeat(200))],
          limits: caps({ bytes: held + 100 }),
        })
      );

      assert.ok(e instanceof OverChatLimit, String(e));
      assert.equal(e.limit.reason, "conversations-too-large");
      assert.equal(e.limit.limit, held + 100);
      assert.ok(e.limit.count > held + 200, String(e.limit.count));
      assert.equal((await counts()).messages, 1);
    });

    it("does not count a conversation deleted with its project", async () => {
      await project("gone");
      await push({
        threadId: randomUUID(),
        items: [item()],
        limits: roomy,
        projectId: "gone",
      });
      await query(
        "update conversations set deleted_at = now() where user_id = $1",
        [userId]
      );
      await query(
        "delete from messages m using conversations c where m.conversation_id = c.id and c.user_id = $1",
        [userId]
      );
      await project("p1");

      await push({
        threadId: randomUUID(),
        items: [item()],
        limits: caps({ threads: 1, messages: 1 }),
      });

      assert.equal((await counts()).threads, 1);
    });

    it("lets exactly one of two racing pushes take the last place", async () => {
      await project("p1");
      const limits = caps({ threads: 1 });

      const outcomes = await Promise.allSettled([
        push({ threadId: randomUUID(), items: [], limits }),
        push({ threadId: randomUUID(), items: [], limits }),
      ]);

      assert.deepEqual(outcomes.map((o) => o.status).sort(), [
        "fulfilled",
        "rejected",
      ]);
      assert.equal((await counts()).threads, 1);
    });
  }
);
