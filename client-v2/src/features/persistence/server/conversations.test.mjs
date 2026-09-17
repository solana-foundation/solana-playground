import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { query } from "./db.mjs";
import { appendMessages, listMessages } from "./conversations.mjs";

// `yarn test-api` loads `.env`; without a database this suite skips rather
// than fails, which is what lets the unit suites run on their own.
const DB = process.env.DATABASE_URL;

describe("conversations", { skip: !DB && "DATABASE_URL not set" }, () => {
  const userId = "test-user";

  before(async () => {
    await query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, 'Test', 'test@example.com', false, now(), now())
       on conflict (id) do nothing`,
      [userId]
    );
  });

  beforeEach(async () => {
    await query("delete from projects where user_id = $1", [userId]);
  });

  const item = (n) => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    kind: "user",
    createdAt: new Date(n * 1000).toISOString(),
    text: `m${n}`,
  });

  it("returns an empty thread for an unknown project", async () => {
    assert.deepEqual(await listMessages(userId, "nope"), []);
  });

  it("creates the project and conversation on first append", async () => {
    await appendMessages(userId, "p1", [item(1)]);
    const items = await listMessages(userId, "p1");
    assert.equal(items.length, 1);
    assert.equal(items[0].text, "m1");
  });

  it("is idempotent, so a repeated dump changes nothing", async () => {
    await appendMessages(userId, "p1", [item(1), item(2)]);
    await appendMessages(userId, "p1", [item(1), item(2)]);
    assert.equal((await listMessages(userId, "p1")).length, 2);
  });

  it("orders by creation time, then id", async () => {
    await appendMessages(userId, "p1", [item(3), item(1), item(2)]);
    const items = await listMessages(userId, "p1");
    assert.deepEqual(
      items.map((i) => i.text),
      ["m1", "m2", "m3"]
    );
  });

  it("does not leak another user's thread", async () => {
    await appendMessages(userId, "p1", [item(1)]);
    assert.deepEqual(await listMessages("someone-else", "p1"), []);
  });
});
