import assert from "node:assert/strict";
import { once } from "node:events";
import { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import {
  initServerLogger,
  resetServerLogger,
} from "../../../../shared/lib/logger/server.mjs";
import { connector, createPool } from "./cloud-sql.mjs";

const MINUTE = 60 * 1000;

/** A preview deployment the refusal lets through */
const ENV = {
  DB_PROVIDER: "cloud-sql",
  CLOUD_SQL_INSTANCE: "project:region:solpg-preview",
  CLOUD_SQL_DATABASE: "solpg_preview_pr_42",
  CLOUD_SQL_USER: "vercel-preview@project.iam",
  GCP_PROJECT_NUMBER: "123",
  GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel",
  GCP_SERVICE_ACCOUNT_EMAIL: "vercel-preview@project.iam.gserviceaccount.com",
  VERCEL_ENV: "preview",
};

/**
 * A socket that fails as soon as `pg` connects it, which `pg` answers by
 * destroying it: a case needs only to see which connector opened it.
 */
class RefusedSocket extends Duplex {
  _read() {}
  // eslint-disable-next-line max-params -- Node's `Writable` defines this signature
  _write(_chunk, _encoding, callback) {
    callback();
  }
  setNoDelay() {}
  setKeepAlive() {}
  connect() {
    process.nextTick(() => this.emit("error", new Error("refused")));
  }
}

/**
 * A stand-in connector: keeps the sockets it opened and counts its closes.
 *
 * @param {number} id
 */
const fakeLink = (id) => {
  const link = {
    id,
    /** @type {RefusedSocket[]} */
    sockets: [],
    closed: 0,
    stream: () => {
      const socket = new RefusedSocket();
      link.sockets.push(socket);
      return socket;
    },
    close: () => {
      link.closed += 1;
    },
  };
  return link;
};

/**
 * Replaces `connector.open` with one that hands out fake links in order;
 * a value of `Error` rejects instead, and a promise is awaited.
 *
 * @param {(ReturnType<typeof fakeLink> | Error | Promise<ReturnType<typeof fakeLink>>)[]} links
 */
const openReturning = (links) => {
  const queue = links.slice();
  return mock.method(connector, "open", async () => {
    const next = queue.shift();
    if (!next) throw new Error("no more links");
    if (next instanceof Error) throw next;
    return await next;
  });
};

/** A link the case hands out when it chooses, for a renewal still running */
const slowLink = (link) => {
  /** @type {() => void} */
  let release = () => {};
  const promise = new Promise((resolve) => {
    release = () => resolve(link);
  });
  return { promise, release };
};

/** Resolves after `ms` of real time: `mock.timers` mocks `Date` only */
const after = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Draws a connection, which fails on the fake socket; the draw is the point */
const draw = async (pool) => {
  await assert.rejects(() => pool.connect());
};

/** The same through the callback form `pg-pool`'s `query` uses */
const drawWithCallback = (pool) =>
  new Promise((resolve) => {
    pool.connect((error) => {
      assert.ok(error);
      resolve();
    });
  });

describe("persistence/model/providers/cloud-sql", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["Date"], now: 0 });
  });
  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
    resetServerLogger();
  });

  it("opens sockets through the first connector while it is younger than the limit", async () => {
    const first = fakeLink(1);
    const open = openReturning([first]);
    const pool = await createPool(ENV);
    mock.timers.tick(44 * MINUTE);
    await draw(pool);
    assert.equal(open.mock.callCount(), 1);
    assert.equal(first.sockets.length, 1);
  });

  it("takes a new connector before connecting once the current one is old", async () => {
    // HOO-2956: an instance frozen past the certificate's hour connected with
    // the old certificate and was refused with "bad certificate"
    const first = fakeLink(1);
    const second = fakeLink(2);
    const open = openReturning([first, second]);
    const pool = await createPool(ENV);
    // The first production event: 1h14m after the instance started
    mock.timers.tick(74 * MINUTE);
    await draw(pool);
    assert.equal(open.mock.callCount(), 2);
    assert.equal(first.sockets.length, 0);
    assert.equal(second.sockets.length, 1);
  });

  it("renews before the callback form of connect too", async () => {
    const first = fakeLink(1);
    const second = fakeLink(2);
    openReturning([first, second]);
    const pool = await createPool(ENV);
    mock.timers.tick(45 * MINUTE);
    await drawWithCallback(pool);
    assert.equal(first.sockets.length, 0);
    assert.equal(second.sockets.length, 1);
  });

  it("opens one new connector for connections drawn together", async () => {
    const first = fakeLink(1);
    const second = fakeLink(2);
    const open = openReturning([first, second]);
    const pool = await createPool(ENV);
    mock.timers.tick(45 * MINUTE);
    await Promise.all([draw(pool), draw(pool), drawWithCallback(pool)]);
    assert.equal(open.mock.callCount(), 2);
    assert.equal(second.sockets.length, 3);
  });

  it("closes a replaced connector only once its last socket closes", async () => {
    const first = fakeLink(1);
    const second = fakeLink(2);
    openReturning([first, second]);
    const pool = await createPool(ENV);
    const held = [pool.options.stream(), pool.options.stream()];
    mock.timers.tick(45 * MINUTE);
    await draw(pool);
    assert.equal(first.closed, 0);
    held[0].emit("close");
    assert.equal(first.closed, 0);
    held[1].emit("close");
    assert.equal(first.closed, 1);
    assert.equal(second.closed, 0);
  });

  it("closes a replaced connector with no open socket at once", async () => {
    const first = fakeLink(1);
    openReturning([first, fakeLink(2)]);
    const pool = await createPool(ENV);
    mock.timers.tick(45 * MINUTE);
    await draw(pool);
    assert.equal(first.closed, 1);
  });

  it("keeps the old connector and reports when a new one cannot be had", async () => {
    const first = fakeLink(1);
    const second = fakeLink(2);
    const open = openReturning([
      first,
      new Error("certificate fetch failed"),
      second,
    ]);
    /** @type {import("../../../../shared/lib/logger/server.mjs").ServerLogEntry[]} */
    const entries = [];
    initServerLogger({ providers: [{ log: (entry) => entries.push(entry) }] });
    const pool = await createPool(ENV);
    mock.timers.tick(45 * MINUTE);

    await draw(pool);
    assert.equal(first.sockets.length, 1);
    assert.equal(first.closed, 0);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ns, "persistence:cloud-sql");
    assert.equal(entries[0].report, true);
    assert.match(entries[0].error?.message ?? "", /certificate fetch failed/);

    // Closing its last socket does not close a connector still in use
    const [failed] = first.sockets;
    if (!failed.closed) {
      failed.destroy();
      await once(failed, "close");
    }
    assert.equal(first.closed, 0);

    // The next connection tries again, and the replaced connector closes
    await draw(pool);
    assert.equal(open.mock.callCount(), 3);
    assert.equal(second.sockets.length, 1);
    assert.equal(first.closed, 1);
  });

  it("goes through the old connector while a slow renewal runs and the old one still works", async () => {
    const first = fakeLink(1);
    const second = fakeLink(2);
    const slow = slowLink(second);
    const open = openReturning([first, slow.promise]);
    const pool = await createPool(ENV);
    mock.timers.tick(50 * MINUTE);

    // Held no longer than the renewal wait, then through the old connector
    await draw(pool);
    assert.equal(first.sockets.length, 1);
    assert.equal(second.sockets.length, 0);

    // The renewal carries on and serves the next connection, without a
    // second request to Google
    slow.release();
    await draw(pool);
    assert.equal(open.mock.callCount(), 2);
    assert.equal(second.sockets.length, 1);
  });

  it("keeps a connection open unused for as long as a turn may run", async () => {
    // HOO-2996: a settle 29 s after its reserve found the connection closed
    // and could not open a new one in time
    openReturning([fakeLink(1)]);
    const pool = await createPool(ENV);
    assert.equal(pool.options.idleTimeoutMillis, 300_000);
  });

  it("puts the pool's state and the connect's timings on a failed connect", async () => {
    openReturning([fakeLink(1)]);
    const pool = await createPool(ENV);
    mock.timers.tick(10 * MINUTE);
    const error = await pool.connect().then(
      () => assert.fail("the fake socket refuses every connect"),
      (e) => e
    );
    assert.deepEqual(error.connect, {
      idle: 0,
      total: 0,
      waiting: 0,
      linkAgeMs: 10 * MINUTE,
      renewMs: 0,
      connectMs: 0,
    });
  });

  it("puts the same on a failed connect through the callback form", async () => {
    openReturning([fakeLink(1)]);
    const pool = await createPool(ENV);
    const error = await new Promise((resolve) => {
      pool.connect((e) => resolve(e));
    });
    assert.deepEqual(error.connect, {
      idle: 0,
      total: 0,
      waiting: 0,
      linkAgeMs: 0,
      renewMs: 0,
      connectMs: 0,
    });
  });

  it("waits for a slow renewal once the old connector is stale", async () => {
    const first = fakeLink(1);
    const second = fakeLink(2);
    const slow = slowLink(second);
    openReturning([first, slow.promise]);
    const pool = await createPool(ENV);
    mock.timers.tick(74 * MINUTE);

    const drawn = draw(pool);
    // Past the renewal wait, nothing went through the expired certificate
    await after(2500);
    assert.equal(first.sockets.length, 0);
    slow.release();
    await drawn;
    assert.equal(first.sockets.length, 0);
    assert.equal(second.sockets.length, 1);
  });
});
