import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { finishAuditWith, startAuditWith } from "./audit.mjs";

describe("startAuditWith", () => {
  it("inserts one row and returns its id", async () => {
    const query = mock.fn(async () => ({ rows: [{ id: "7" }] }));

    const id = await startAuditWith(query)({
      userId: "u1",
      project: { id: "p1", name: "hello" },
      unstable: false,
      bytes: 120,
    });

    assert.equal(id, 7);
    assert.equal(query.mock.callCount(), 1);
    const [text, params] = query.mock.calls[0].arguments;
    assert.match(text, /insert into build_audit/);
    assert.match(text, /select login from "user" where id = \$1/);
    assert.deepEqual(params, ["u1", "p1", "hello", false, 120]);
  });

  it("lets a database failure through, so the route can refuse", async () => {
    const query = async () => {
      throw new Error("connection refused");
    };
    await assert.rejects(
      startAuditWith(query)({
        userId: "u1",
        project: {},
        unstable: false,
        bytes: 0,
      }),
      /connection refused/
    );
  });
});

describe("finishAuditWith", () => {
  it("records the outcome on the row", async () => {
    const query = mock.fn(async () => ({ rows: [] }));

    await finishAuditWith(query)({
      id: 7,
      programUuid: "abc",
      status: 200,
      durationMs: 1500,
    });

    const [text, params] = query.mock.calls[0].arguments;
    assert.match(text, /update build_audit/);
    assert.deepEqual(params, [7, "abc", 200, 1500]);
  });

  it("never throws: the build has already been answered", async () => {
    const query = async () => {
      throw new Error("gone");
    };
    await finishAuditWith(query)({ id: 7, status: 502, durationMs: 3 });
  });

  it("gives up on a stalled database, so the answer is not held", async () => {
    const query = () => new Promise(() => {});
    const started = Date.now();
    await finishAuditWith(query, { deadlineMs: 20 })({
      id: 7,
      status: 200,
      durationMs: 3,
    });
    assert.ok(Date.now() - started < 1_000);
  });
});
