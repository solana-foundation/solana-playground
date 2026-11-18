import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { describe, it, mock } from "node:test";

import { handleWith } from "./build-server.mjs";

const UUID = "0b9f4d3e-6c1a-4f7e-9a2b-3c4d5e6f7a8b";

/** A request as Vercel hands it over: the rewrite's `?path=`, a raw body ("" for none) */
const request = (method, path, raw) => {
  const req = Readable.from(raw ? [Buffer.from(raw)] : []);
  req.method = method;
  req.url = `/api/build-server?path=${encodeURIComponent(path)}`;
  req.headers = {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(raw)),
  };
  return req;
};

/** A build request carrying `body` as JSON */
const postBuild = (body) => request("POST", "build", JSON.stringify(body));

/** A build request with no body at all */
const emptyBuild = () => request("POST", "build", "");

/** A GET to `path`, as the deploy download sends it */
const getPath = (path) => request("GET", path, "");

/** A response that records what was written and supports backpressure */
const makeRes = () => {
  const res = new EventEmitter();
  Object.assign(res, {
    statusCode: 0,
    headers: {},
    chunks: [],
    ended: false,
    headersSent: false,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    write(chunk) {
      this.headersSent = true;
      this.chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      this.headersSent = true;
      if (chunk) this.chunks.push(Buffer.from(chunk));
      this.ended = true;
      this.emit("close");
    },
    destroyed: false,
    destroy(err) {
      this.destroyed = true;
      this.destroyError = err;
      this.emit("close");
    },
  });
  Object.defineProperty(res, "body", {
    get() {
      return Buffer.concat(res.chunks).toString("utf8");
    },
  });
  return res;
};

const signedIn = async () => ({ status: "signed-in", user: { id: "u1" } });

/** Every dependency stubbed; a case overrides what it is about */
/** The handler's dependencies, each taken from `over` when it names one */
const depsWith = (over) => {
  const query = mock.fn(async (text) =>
    /insert/.test(text) ? { rows: [{ id: "9" }] } : { rows: [] }
  );
  const fetch = mock.fn(
    async () =>
      // `idl` is JSON null for a native program
      new Response(`{"stderr":"ok","uuid":"${UUID}","idl":null}`, {
        status: 200,
        headers: { "content-type": "application/json" },
      })
  );
  return {
    readSession: over.readSession ?? signedIn,
    isAllowedOrigin: over.isAllowedOrigin ?? (() => true),
    query: over.query ?? query,
    fetch: over.fetch ?? fetch,
    env: over.env ?? (() => ({ URL: "https://server.test", API_KEY: "k3y" })),
    isProduction: over.isProduction ?? (() => false),
  };
};

/**
 * The statements that write or close the audit row, without the limit check's
 * count that comes first
 */
const auditCalls = (d) =>
  d.query.mock.calls.filter(
    (c) => !/from build_audit\s+where user_id/.test(c.arguments[0])
  );

/** The handler's dependencies for a signed-in build that succeeds */
const deps = () => depsWith({});

/** A first build: no program UUID yet, so the request carries none */
const FILES = [["src/lib.rs", "fn main() {}"]];
const BUILD = { files: FILES };

describe("/api/build-server", () => {
  it("refuses a signed-out caller with 401 and never calls the server", async () => {
    const d = depsWith({ readSession: async () => ({ status: "signed-out" }) });
    const res = makeRes();

    await handleWith(d)(postBuild(BUILD), res);

    assert.equal(res.statusCode, 401);
    assert.deepEqual(JSON.parse(res.body), {
      error: "Sign in with GitHub to build.",
      reason: "signed-out",
    });
    assert.equal(d.fetch.mock.callCount(), 0);
    assert.equal(d.query.mock.callCount(), 0);
  });

  it("refuses another site's origin with 403", async () => {
    const d = depsWith({ isAllowedOrigin: () => false });
    const res = makeRes();

    await handleWith(d)(postBuild(BUILD), res);

    assert.equal(res.statusCode, 403);
    assert.equal(d.fetch.mock.callCount(), 0);
  });

  for (const status of ["unconfigured", "unavailable"]) {
    it(`answers 503 when sign-in is ${status}`, async () => {
      const d = depsWith({ readSession: async () => ({ status }) });
      const res = makeRes();

      await handleWith(d)(postBuild(BUILD), res);

      assert.equal(res.statusCode, 503);
      assert.equal(d.fetch.mock.callCount(), 0);
    });
  }

  it("answers 404 for a path outside the build surface", async () => {
    const d = deps();
    const res = makeRes();

    await handleWith(d)(getPath("share/abc"), res);

    assert.equal(res.statusCode, 404);
    assert.equal(d.fetch.mock.callCount(), 0);
  });

  it("answers 405 with Allow for the wrong method", async () => {
    const res = makeRes();

    await handleWith(deps())(getPath("build"), res);

    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "POST");
  });

  it("refuses a body over 1 MiB with 413", async () => {
    const d = deps();
    const res = makeRes();
    const req = postBuild(BUILD);
    req.headers["content-length"] = String(1024 * 1024 + 1);

    await handleWith(d)(req, res);

    assert.equal(res.statusCode, 413);
    assert.equal(d.fetch.mock.callCount(), 0);
  });

  it("refuses with 503 when the audit row cannot be written", async () => {
    const d = depsWith({
      query: mock.fn(async () => {
        throw new Error("db down");
      }),
    });
    const res = makeRes();

    await handleWith(d)(postBuild(BUILD), res);

    assert.equal(res.statusCode, 503);
    assert.equal(d.fetch.mock.callCount(), 0);
  });

  describe("per-user build limits", () => {
    /** A `query` whose count statement answers `counts`, the rest as usual */
    const queryWithCounts = (counts) =>
      mock.fn(async (text) => {
        if (/insert/.test(text)) return { rows: [{ id: "9" }] };
        if (/from build_audit/.test(text) && /count\(\*\)/.test(text)) {
          return { rows: [counts] };
        }
        return { rows: [] };
      });
    const inserts = (d) =>
      d.query.mock.calls.filter((c) => /insert/.test(c.arguments[0]));

    it("builds as before for a user under both limits", async () => {
      const d = depsWith({
        query: queryWithCounts({ running: "0", last_hour: "19" }),
      });
      const res = makeRes();

      await handleWith(d)(postBuild(BUILD), res);

      assert.equal(res.statusCode, 200);
      assert.equal(d.fetch.mock.callCount(), 1);
      assert.equal(inserts(d).length, 1);
    });

    it("answers 429 with Retry-After while a build runs, with no row and no forward", async () => {
      const d = depsWith({
        query: queryWithCounts({
          running: "1",
          last_hour: "1",
          running_frees_in: "120",
        }),
      });
      const res = makeRes();

      await handleWith(d)(postBuild(BUILD), res);

      assert.equal(res.statusCode, 429);
      assert.equal(res.headers["retry-after"], "15");
      assert.equal(JSON.parse(res.body).reason, "build-limit");
      assert.equal(d.fetch.mock.callCount(), 0);
      assert.equal(inserts(d).length, 0);
    });

    it("answers 429 past the hourly limit, asking again when the oldest build leaves the hour", async () => {
      const d = depsWith({
        query: queryWithCounts({
          running: "0",
          last_hour: "20",
          hour_frees_in: "900.2",
        }),
      });
      const res = makeRes();

      await handleWith(d)(postBuild(BUILD), res);

      assert.equal(res.statusCode, 429);
      assert.equal(res.headers["retry-after"], "901");
      assert.equal(d.fetch.mock.callCount(), 0);
      assert.equal(inserts(d).length, 0);
    });

    it("refuses with 503 when the count cannot be read", async () => {
      const d = depsWith({
        query: mock.fn(async (text) => {
          if (/count\(\*\)/.test(text)) throw new Error("db down");
          return { rows: [{ id: "9" }] };
        }),
      });
      const res = makeRes();

      await handleWith(d)(postBuild(BUILD), res);

      assert.equal(res.statusCode, 503);
      assert.equal(d.fetch.mock.callCount(), 0);
      assert.equal(inserts(d).length, 0);
    });

    it("counts nothing for a deploy download", async () => {
      const d = depsWith({
        query: queryWithCounts({ running: "1", last_hour: "99" }),
      });
      const res = makeRes();

      await handleWith(d)(getPath(`deploy/${UUID}`), res);

      assert.equal(res.statusCode, 200);
      assert.equal(d.query.mock.callCount(), 0);
    });
  });

  it("forwards a build with the key and records it", async () => {
    const d = deps();
    const res = makeRes();
    const body = { files: FILES, project: { id: "p1", name: "hello" } };

    await handleWith(d)(postBuild(body), res);

    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).uuid, UUID);

    const [url, init] = d.fetch.mock.calls[0].arguments;
    assert.equal(url, "https://server.test/build");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["x-api-key"], "k3y");
    assert.deepEqual(JSON.parse(init.body), body);

    const [insert, insertParams] = auditCalls(d)[0].arguments;
    assert.match(insert, /insert into build_audit/);
    assert.deepEqual(insertParams.slice(0, 4), ["u1", "p1", "hello", false]);
    const [update, updateParams] = auditCalls(d)[1].arguments;
    assert.match(update, /update build_audit/);
    assert.deepEqual(updateParams.slice(0, 3), [9, UUID, 200]);
  });

  it("sends no key header when none is configured", async () => {
    const d = depsWith({ env: () => ({ URL: "https://server.test" }) });

    await handleWith(d)(postBuild(BUILD), makeRes());

    const [, init] = d.fetch.mock.calls[0].arguments;
    assert.equal("x-api-key" in init.headers, false);
  });

  it("refuses every build without PG_BUILD_SERVER_URL", async () => {
    const d = depsWith({ env: () => ({ URL: undefined, API_KEY: "k3y" }) });
    const handle = handleWith(d);

    for (let i = 0; i < 2; i++) {
      const res = makeRes();
      await handle(postBuild(BUILD), res);
      assert.equal(res.statusCode, 503);
      assert.match(JSON.parse(res.body).error, /no build server configured/);
    }
    assert.equal(d.fetch.mock.callCount(), 0);
    assert.equal(d.query.mock.callCount(), 0);
  });

  it("keeps the program UUID the request already had", async () => {
    const d = depsWith({
      fetch: mock.fn(
        async () =>
          // A rebuild: the server issues no new UUID
          new Response('{"stderr":"","uuid":null,"idl":null}', {
            status: 200,
          })
      ),
    });

    await handleWith(d)(postBuild({ files: FILES, uuid: UUID }), makeRes());

    const [, updateParams] = auditCalls(d)[1].arguments;
    assert.equal(updateParams[1], UUID);
  });

  it("relays a server error's status and text unchanged", async () => {
    const d = depsWith({
      fetch: mock.fn(
        async () =>
          new Response("Invalid UUID", {
            status: 500,
            headers: { "content-type": "text/plain" },
          })
      ),
    });
    const res = makeRes();

    await handleWith(d)(postBuild(BUILD), res);

    assert.equal(res.statusCode, 500);
    assert.equal(res.body, "Invalid UUID");
    assert.equal(res.headers["content-type"], "text/plain");
    assert.equal(auditCalls(d)[1].arguments[1][2], 500);
  });

  it("passes a busy server's 503 and Retry-After through, and records the 503", async () => {
    const d = depsWith({
      fetch: mock.fn(
        async () =>
          new Response("The build server is busy, try again in 30 seconds", {
            status: 503,
            headers: { "content-type": "text/plain", "retry-after": "30" },
          })
      ),
    });
    const res = makeRes();

    await handleWith(d)(postBuild(BUILD), res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.headers["retry-after"], "30");
    assert.match(res.body, /busy/);
    assert.equal(auditCalls(d)[1].arguments[1][2], 503);
  });

  it("sends no Retry-After the server did not send", async () => {
    const d = depsWith({
      fetch: mock.fn(async () => new Response("boom", { status: 500 })),
    });
    const res = makeRes();

    await handleWith(d)(postBuild(BUILD), res);

    assert.equal(res.headers["retry-after"], undefined);
  });

  it("drops a Retry-After that comes with a 500, and still logs the 500", async () => {
    const d = depsWith({
      fetch: mock.fn(
        async () =>
          new Response("boom", {
            status: 500,
            headers: { "retry-after": "30" },
          })
      ),
    });
    const res = makeRes();
    const warn = mock.method(console, "warn", () => {});
    try {
      await handleWith(d)(postBuild(BUILD), res);

      const logged = warn.mock.calls.filter((c) =>
        JSON.stringify(c.arguments).includes("answered with an error")
      );
      assert.equal(logged.length, 1);
    } finally {
      warn.mock.restore();
    }
    assert.equal(res.statusCode, 500);
    assert.equal(res.headers["retry-after"], undefined);
  });

  it("answers 502 when the server cannot be reached, and records it", async () => {
    const d = depsWith({
      fetch: mock.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    const res = makeRes();

    await handleWith(d)(postBuild(BUILD), res);

    assert.equal(res.statusCode, 502);
    assert.match(JSON.parse(res.body).error, /build server/i);
    assert.equal(auditCalls(d)[1].arguments[1][2], 502);
  });

  it("relays a deploy's binary byte for byte, without an audit row", async () => {
    const bytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2, 255]);
    const d = depsWith({
      fetch: mock.fn(
        async () =>
          new Response(bytes, {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          })
      ),
    });
    const res = makeRes();

    await handleWith(d)(getPath(`deploy/${UUID}`), res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(Buffer.concat(res.chunks), bytes);
    assert.equal(
      d.fetch.mock.calls[0].arguments[0],
      `https://server.test/deploy/${UUID}`
    );
    assert.equal(d.fetch.mock.calls[0].arguments[1].body, undefined);
    assert.equal(d.query.mock.callCount(), 0);
  });

  /** A deploy answer whose body yields `sent`, then fails */
  const cutOffDeploy = (sent) =>
    mock.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              for (const b of sent) c.enqueue(b);
            },
            pull(c) {
              c.error(new TypeError("terminated"));
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          }
        )
    );

  it("destroys, never ends, a deploy cut off after some bytes", async () => {
    const res = makeRes();

    await handleWith(
      depsWith({ fetch: cutOffDeploy([new Uint8Array([1, 2])]) })
    )(getPath(`deploy/${UUID}`), res);

    assert.equal(res.ended, false);
    assert.equal(res.destroyed, true);
  });

  it("answers 502 for a deploy cut off before its first byte", async () => {
    const res = makeRes();

    await handleWith(depsWith({ fetch: cutOffDeploy([]) }))(
      getPath(`deploy/${UUID}`),
      res
    );

    assert.equal(res.statusCode, 502);
    assert.equal(res.ended, true);
  });

  it("keeps no listeners behind while waiting on a slow caller", async () => {
    let left = 30;
    const res = makeRes();
    let most = 0;
    res.write = function (chunk) {
      most = Math.max(most, this.listenerCount("close"));
      this.headersSent = true;
      this.chunks.push(Buffer.from(chunk));
      queueMicrotask(() => this.emit("drain"));
      return false;
    };
    const d = depsWith({
      fetch: mock.fn(
        async () =>
          new Response(
            new ReadableStream({
              pull(c) {
                if (left-- > 0) c.enqueue(new Uint8Array([7]));
                else c.close();
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/octet-stream" },
            }
          )
      ),
    });

    await handleWith(d)(getPath(`deploy/${UUID}`), res);

    // Ending the response clears them anyway: count while it streams
    assert.ok(most <= 1, `${most} close listeners at once`);
  });

  it("aborts the server request when the caller leaves", async () => {
    const res = makeRes();
    let signal;
    const d = depsWith({
      fetch: mock.fn(async (_url, init) => {
        signal = init.signal;
        res.destroyed = true;
        res.emit("close");
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }),
    });

    await handleWith(d)(postBuild(BUILD), res);

    assert.equal(signal.aborted, true);
    assert.equal(auditCalls(d)[1].arguments[1][2], 499);
  });

  it("starts no build for a caller who left while the audit row was written", async () => {
    const res = makeRes();
    const query = mock.fn(async (text) => {
      if (/insert/.test(text)) {
        res.destroyed = true;
        res.emit("close");
        return { rows: [{ id: "9" }] };
      }
      return { rows: [] };
    });
    const d = depsWith({ query });

    await handleWith(d)(postBuild(BUILD), res);

    assert.equal(d.fetch.mock.callCount(), 0);
    assert.equal(auditCalls({ query })[1].arguments[1][2], 499);
  });

  for (const [method, path] of [
    ["POST", "build"],
    ["GET", `deploy/${UUID}`],
  ]) {
    it(`refuses a signed-out ${method} ${path} before any call`, async () => {
      const d = depsWith({
        readSession: async () => ({ status: "signed-out" }),
      });
      const res = makeRes();

      await handleWith(d)(
        request(method, path, method === "POST" ? JSON.stringify(BUILD) : ""),
        res
      );

      assert.equal(res.statusCode, 401);
      assert.equal(d.fetch.mock.callCount(), 0);
    });
  }

  it("sends the build server only the headers it needs, never the caller's", async () => {
    const d = deps();
    const req = postBuild(BUILD);
    req.headers.cookie = "session=abc";
    req.headers.authorization = "Bearer user";
    req.headers["x-api-key"] = "forged";

    await handleWith(d)(req, makeRes());

    const [, init] = d.fetch.mock.calls[0].arguments;
    assert.deepEqual(init.headers, {
      accept: "*/*",
      "content-type": "application/json",
      "x-api-key": "k3y",
    });
  });

  it("forwards a body the platform already parsed as JSON", async () => {
    const d = deps();
    const req = postBuild(BUILD);
    req.body = { files: FILES, project: { id: "p1", name: "hello" } };

    await handleWith(d)(req, makeRes());

    const [, init] = d.fetch.mock.calls[0].arguments;
    assert.deepEqual(JSON.parse(init.body), {
      files: FILES,
      project: { id: "p1", name: "hello" },
    });
  });

  it("answers 400 for a body that is not JSON, with no audit row", async () => {
    const d = deps();
    const req = emptyBuild();
    req.body = "{not json";
    const res = makeRes();

    await handleWith(d)(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(auditCalls(d).length, 0);
    assert.equal(d.fetch.mock.callCount(), 0);
  });

  it("turns the server refusing the route's key into a 502, not a sign-in prompt", async () => {
    const d = depsWith({
      fetch: mock.fn(
        async () => new Response("Missing or invalid API key", { status: 401 })
      ),
    });
    const res = makeRes();

    await handleWith(d)(postBuild(BUILD), res);

    assert.equal(res.statusCode, 502);
    assert.equal(JSON.parse(res.body).reason, undefined);
    assert.equal(auditCalls(d)[1].arguments[1][2], 502);
  });

  it("answers 502 when the server's answer is cut off", async () => {
    const broken = new Response("{}", { status: 200 });
    broken.text = async () => {
      throw new TypeError("terminated");
    };
    const d = depsWith({ fetch: mock.fn(async () => broken) });
    const res = makeRes();

    await handleWith(d)(postBuild(BUILD), res);

    assert.equal(res.statusCode, 502);
    assert.equal(auditCalls(d)[1].arguments[1][2], 502);
  });

  it("records 499, not the server's 200, when the caller left before the answer", async () => {
    const res = makeRes();
    const d = depsWith({
      fetch: mock.fn(async () => {
        res.destroyed = true;
        return new Response(`{"stderr":"","uuid":"${UUID}"}`, { status: 200 });
      }),
    });

    await handleWith(d)(postBuild(BUILD), res);

    assert.equal(auditCalls(d)[1].arguments[1][2], 499);
    assert.equal(res.chunks.length, 0);
  });

  it("records the server's UUID, never an arbitrary string from the request", async () => {
    const d = deps();

    await handleWith(d)(
      postBuild({ files: FILES, uuid: "x".repeat(5000) }),
      makeRes()
    );

    assert.equal(auditCalls(d)[1].arguments[1][1], UUID);
  });

  it("records no UUID when neither side has a well-formed one", async () => {
    const d = depsWith({
      fetch: mock.fn(
        async () => new Response("error: could not compile", { status: 200 })
      ),
    });

    await handleWith(d)(
      postBuild({ files: FILES, uuid: "not-a-uuid" }),
      makeRes()
    );

    assert.equal(auditCalls(d)[1].arguments[1][1], undefined);
  });

  it("says once, in production, that the build server is open without a key", async () => {
    const d = depsWith({
      env: () => ({ URL: "https://server.test" }),
      isProduction: () => true,
    });
    const error = mock.method(console, "error", () => {});
    try {
      const handler = handleWith(d);
      await handler(postBuild(BUILD), makeRes());
      await handler(postBuild(BUILD), makeRes());

      const warnings = error.mock.calls.filter((c) =>
        JSON.stringify(c.arguments).includes("PG_BUILD_SERVER_API_KEY")
      );
      assert.equal(warnings.length, 1);
      assert.equal(d.fetch.mock.callCount(), 2);
    } finally {
      error.mock.restore();
    }
  });

  it("answers 404 for a deploy of something that is not a UUID", async () => {
    const d = deps();
    const res = makeRes();

    await handleWith(d)(getPath("deploy/not-a-uuid"), res);

    assert.equal(res.statusCode, 404);
    assert.equal(d.fetch.mock.callCount(), 0);
  });
});
