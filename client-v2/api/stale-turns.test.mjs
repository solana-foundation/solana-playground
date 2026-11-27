import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import {
  initServerLogger,
  resetServerLogger,
} from "../src/shared/lib/logger/server.mjs";
import { handleWith } from "./stale-turns.mjs";

const SECRET = "a-made-up-cron-secret";

/** Minimal stand-in for the platform's response object */
const makeRes = () => ({
  statusCode: 0,
  headers: {},
  body: "",
  setHeader(k, v) {
    this.headers[k.toLowerCase()] = v;
  },
  end(b) {
    this.body = b ?? "";
  },
});

/** Runs `handler` on a request with `method` (`GET` unless given) and `authorization` */
const call = async (handler, request) => {
  const { method = "GET", authorization } = request;
  const res = makeRes();
  await handler(
    { method, headers: authorization ? { authorization } : {} },
    res
  );
  return res;
};

describe("/api/stale-turns", () => {
  /** What the route logged in this test */
  let entries;

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    entries = [];
    initServerLogger({ providers: [{ log: (entry) => entries.push(entry) }] });
  });

  after(() => resetServerLogger());

  /** A sweep that counts its runs and ends `ended` turns */
  const sweepEnding = (ended) => {
    const sweep = async () => {
      sweep.runs += 1;
      return ended;
    };
    sweep.runs = 0;
    return sweep;
  };

  it("answers 200 with the number of turns the sweep ended", async () => {
    const sweep = sweepEnding(2);
    const res = await call(handleWith({ sweep }), {
      authorization: `Bearer ${SECRET}`,
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { staleTurns: 2 });
    assert.equal(sweep.runs, 1);
  });

  it("answers 500 and reports when the sweep fails", async () => {
    const handler = handleWith({
      sweep: async () => {
        throw new Error("connection timeout");
      },
    });
    const res = await call(handler, { authorization: `Bearer ${SECRET}` });
    assert.equal(res.statusCode, 500);
    assert.equal("staleTurns" in JSON.parse(res.body), false);
    assert.deepEqual(
      entries.map(({ level, report, error }) => ({
        level,
        report,
        message: error?.message,
      })),
      [
        {
          level: "error",
          report: true,
          message: "stale-turns sweep failed",
        },
      ]
    );
  });

  it("answers 503, reports, and sweeps nothing while CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const sweep = sweepEnding(1);
    const res = await call(handleWith({ sweep }), {
      authorization: `Bearer ${SECRET}`,
    });
    assert.equal(res.statusCode, 503);
    assert.equal(sweep.runs, 0);
    assert.deepEqual(
      entries.map(({ level, report, error }) => ({
        level,
        report,
        message: error?.message,
      })),
      [
        {
          level: "error",
          report: true,
          message: "CRON_SECRET is unset; stale-turns did not run",
        },
      ]
    );
  });

  it("answers 401 and sweeps nothing without the cron secret", async () => {
    const sweep = sweepEnding(1);
    const res = await call(handleWith({ sweep }), {
      authorization: "Bearer short",
    });
    assert.equal(res.statusCode, 401);
    assert.equal(sweep.runs, 0);
  });

  it("answers 405 with Allow: GET and sweeps nothing for another method", async () => {
    const sweep = sweepEnding(1);
    const res = await call(handleWith({ sweep }), {
      method: "POST",
      authorization: `Bearer ${SECRET}`,
    });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "GET");
    assert.equal(sweep.runs, 0);
  });
});
