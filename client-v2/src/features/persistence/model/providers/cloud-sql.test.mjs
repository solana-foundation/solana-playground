import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { connector, createPool } from "./cloud-sql.mjs";

/** A preview deployment, which `createPool` lets open its database */
const ENV = {
  DB_PROVIDER: "cloud-sql",
  CLOUD_SQL_INSTANCE: "project:region:solpg-preview",
  CLOUD_SQL_DATABASE: "solpg_preview_pr_42",
  CLOUD_SQL_USER: "vercel-preview@project.iam",
  VERCEL_ENV: "preview",
};

const MINUTE = 60_000;

/**
 * A socket that fails as soon as `pg` connects it, so a case sees which
 * connector a connection went through without reaching a database
 */
const failingSocket = () => {
  const socket = new PassThrough();
  socket.setNoDelay = () => {};
  socket.connect = () =>
    process.nextTick(() => socket.destroy(new Error("no database here")));
  return socket;
};

/**
 * Stands in for the connector. Each call is one connector, with its own
 * certificate: `streams[i]` counts the sockets connector `i` opened and
 * `closes[i]` whether it was closed.
 */
const stubConnectors = () => {
  const streams = [];
  const closes = [];
  const options = mock.method(connector, "options", async () => {
    const i = streams.length;
    streams.push(0);
    closes.push(0);
    return {
      stream: () => {
        streams[i] += 1;
        return failingSocket();
      },
      close: () => {
        closes[i] += 1;
      },
    };
  });
  return { options, streams, closes };
};

describe("cloud-sql pool", () => {
  beforeEach(() => mock.timers.enable({ apis: ["Date"], now: 0 }));
  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
  });

  // The connector's client certificate lasts an hour and is renewed by a
  // timer, which does not run while Vercel has the function frozen: a warm
  // instance woken after an hour connected with an expired certificate, and
  // the server refused it ("bad certificate", Sentry SOLANA-PLAYGROUND-G)
  it("takes a fresh certificate before connecting once the last is 45 minutes old", async () => {
    const { options, streams } = stubConnectors();
    const pool = await createPool(ENV);

    await assert.rejects(() => pool.connect(), /no database here/);
    assert.deepEqual(streams, [1]);

    mock.timers.tick(44 * MINUTE);
    await assert.rejects(() => pool.connect(), /no database here/);
    assert.equal(options.mock.callCount(), 1);
    assert.deepEqual(streams, [2]);

    mock.timers.tick(2 * MINUTE);
    await assert.rejects(() => pool.connect(), /no database here/);
    assert.equal(options.mock.callCount(), 2);
    assert.deepEqual(streams, [2, 1]);
  });

  it("renews once for connections that ask at the same time", async () => {
    const { options } = stubConnectors();
    const pool = await createPool(ENV);
    mock.timers.tick(46 * MINUTE);

    await Promise.allSettled([pool.connect(), pool.connect()]);
    assert.equal(options.mock.callCount(), 2);
  });

  it("serves query(), which connects through a callback", async () => {
    const { options, streams } = stubConnectors();
    const pool = await createPool(ENV);
    mock.timers.tick(46 * MINUTE);

    await assert.rejects(() => pool.query("select 1"), /no database here/);
    assert.equal(options.mock.callCount(), 2);
    assert.deepEqual(streams, [0, 1]);
  });

  it("closes a replaced connector once its last socket has closed", async () => {
    const { closes } = stubConnectors();
    const pool = await createPool(ENV);

    // A connection still open on the first connector
    const open = pool.options.stream();
    mock.timers.tick(46 * MINUTE);
    await assert.rejects(() => pool.connect(), /no database here/);
    assert.deepEqual(closes, [0, 0]);

    open.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(closes, [1, 0]);
  });

  it("keeps the current connector when a renewal fails, and retries it", async () => {
    const { options, streams } = stubConnectors();
    const pool = await createPool(ENV);
    mock.timers.tick(46 * MINUTE);

    options.mock.mockImplementationOnce(async () => {
      throw new Error("sts unavailable");
    }, options.mock.callCount());
    await assert.rejects(() => pool.connect(), /sts unavailable/);
    assert.deepEqual(streams, [0]);

    await assert.rejects(() => pool.connect(), /no database here/);
    assert.equal(options.mock.callCount(), 3);
    assert.deepEqual(streams, [0, 1]);
  });
});
