import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { query } from "./db.mjs";
import {
  deleteProject,
  getProject,
  listProjects,
  saveProject,
} from "./projects.mjs";

// `yarn test-api` loads `.env`; without a database this suite skips rather
// than fails, which is what lets the unit suites run on their own.
const DB = process.env.DATABASE_URL;

describe("projects", { skip: !DB && "DATABASE_URL not set" }, () => {
  const userId = "test-user-projects";

  before(async () => {
    await query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, 'Test', 'projects@example.com', false, now(), now())
       on conflict (id) do nothing`,
      [userId]
    );
  });

  beforeEach(async () => {
    await query("delete from projects where user_id = $1", [userId]);
  });

  const snapshot = { files: { "src/lib.rs": "fn main() {}" } };

  it("saves and reads a snapshot back", async () => {
    await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot,
    });
    const project = await getProject(userId, "p1");
    assert.deepEqual(project.snapshot, snapshot);
  });

  it("accepts a write that carries the current updatedAt", async () => {
    const first = await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot,
    });
    const second = await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot,
      baseUpdatedAt: first.updatedAt,
    });
    assert.ok(second.updatedAt);
    assert.notEqual(second.conflict, true);
  });

  it("refuses a write built on a stale read", async () => {
    await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot,
    });
    const result = await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot,
      baseUpdatedAt: "2000-01-01T00:00:00.000Z",
    });
    assert.equal(result.conflict, true);
  });

  it("hands back a token the client can retry with", async () => {
    await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot,
    });
    const stale = await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot,
      baseUpdatedAt: "2000-01-01T00:00:00.000Z",
    });
    assert.equal(stale.conflict, true);

    // The whole point of returning a token with the conflict: the client's
    // next attempt, built on it, must go through.
    const retry = await saveProject(userId, {
      id: "p1",
      name: "two",
      kind: "project",
      snapshot,
      baseUpdatedAt: stale.updatedAt,
    });
    assert.notEqual(retry.conflict, true);
    assert.equal((await getProject(userId, "p1")).name, "two");
  });

  it("refuses to clobber an existing project when no token is offered", async () => {
    await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot,
    });
    const result = await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot: { files: {} },
    });

    assert.equal(result.conflict, true);
    assert.deepEqual((await getProject(userId, "p1")).snapshot, snapshot);
  });

  it("clobbers only when the caller says so in as many words", async () => {
    await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot,
    });
    const result = await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot: { files: {} },
      force: true,
    });

    assert.notEqual(result.conflict, true);
    assert.deepEqual((await getProject(userId, "p1")).snapshot, { files: {} });
  });

  it("does not resurrect a tombstoned project behind the user's back", async () => {
    await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot,
    });
    await deleteProject(userId, "p1");

    const result = await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot,
    });
    assert.equal(result.conflict, true);
    assert.equal(await getProject(userId, "p1"), null);
  });

  it("tombstones rather than deleting, so another device does not resurrect it", async () => {
    await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot,
    });
    await deleteProject(userId, "p1");

    assert.equal(await getProject(userId, "p1"), null);
    const { rows } = await query(
      "select deleted_at from projects where id = $1 and user_id = $2",
      ["p1", userId]
    );
    assert.ok(rows[0].deleted_at);
  });

  it("omits tombstoned projects from the list", async () => {
    await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot,
    });
    await saveProject(userId, {
      id: "p2",
      name: "two",
      kind: "project",
      snapshot,
    });
    await deleteProject(userId, "p1");

    const list = await listProjects(userId);
    assert.deepEqual(
      list.map((p) => p.id),
      ["p2"]
    );
  });

  it("frees the name for reuse once tombstoned", async () => {
    await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot,
    });
    await deleteProject(userId, "p1");
    const again = await saveProject(userId, {
      id: "p2",
      name: "one",
      kind: "project",
      snapshot,
    });
    assert.ok(again.updatedAt);
  });
});
