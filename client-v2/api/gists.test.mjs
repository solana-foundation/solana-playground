import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createHandler, NoGithubGrant } from "./gists.mjs";

const TOKEN = "gho_secret";
const FILES = { "src__lib.rs": { content: "x" } };

/** Minimal stand-in for the platform's response object */
const makeRes = () => ({
  statusCode: 0,
  headers: {},
  body: "",
  setHeader(k, v) {
    this.headers[k] = v;
  },
  end(b) {
    this.body = b ?? "";
  },
});

/** A request whose body the platform already parsed, as Vercel's is */
const makeReq = ({
  method = "POST",
  body = { description: "p", files: FILES },
} = {}) => ({
  method,
  url: "/api/gists",
  headers: {},
  body,
});

/** Every dependency answering as for a signed-in user whose token works */
const deps = (over = {}) => {
  const calls = { createGist: [], getAccessToken: [] };
  const all = {
    isAllowedOrigin: () => true,
    readSession: async () => ({ status: "signed-in", user: { id: "u1" } }),
    getAccessToken: async (userId) => {
      calls.getAccessToken.push(userId);
      return TOKEN;
    },
    createGist: async (args) => {
      calls.createGist.push(args);
      return {
        status: 201,
        body: { url: "https://gist.github.com/a/b", id: "b" },
      };
    },
  };
  for (const [name, fn] of Object.entries(over)) all[name] = fn;
  return { deps: all, calls };
};

const call = async (req, d) => {
  const res = makeRes();
  await createHandler(d)(req, res);
  return { status: res.statusCode, body: JSON.parse(res.body || "null"), res };
};

describe("/api/gists", () => {
  it("creates the gist with the user's token and answers 201", async () => {
    const { deps: d, calls } = deps();

    const { status, body, res } = await call(makeReq(), d);

    assert.equal(status, 201);
    assert.deepEqual(body, { url: "https://gist.github.com/a/b", id: "b" });
    assert.deepEqual(calls.getAccessToken, ["u1"]);
    assert.equal(calls.createGist[0].token, TOKEN);
    assert.equal(calls.createGist[0].description, "p");
    assert.deepEqual(calls.createGist[0].files, FILES);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.ok(!res.body.includes(TOKEN));
  });

  it("405s anything but a POST", async () => {
    const { deps: d } = deps();
    assert.equal((await call(makeReq({ method: "GET" }), d)).status, 405);
  });

  it("403s another origin before reading the session", async () => {
    let read = false;
    const { deps: d } = deps({
      isAllowedOrigin: () => false,
      readSession: async () => {
        read = true;
        return { status: "signed-in", user: { id: "u1" } };
      },
    });

    assert.equal((await call(makeReq(), d)).status, 403);
    assert.equal(read, false);
  });

  it("401s a signed-out request and never calls GitHub", async () => {
    const { deps: d, calls } = deps({
      readSession: async () => ({ status: "signed-out" }),
    });

    const { status, body } = await call(makeReq(), d);

    assert.equal(status, 401);
    assert.equal(body.reason, "signed-out");
    assert.equal(calls.createGist.length, 0);
  });

  it("503s when sign-in is unconfigured or the lookup failed", async () => {
    for (const session of ["unconfigured", "unavailable"]) {
      const { deps: d } = deps({
        readSession: async () => ({ status: session }),
      });
      assert.equal((await call(makeReq(), d)).status, 503, session);
    }
  });

  it("400s a malformed body", async () => {
    const { deps: d, calls } = deps();
    const bodies = [
      "not json",
      { files: FILES },
      { description: "p" },
      { description: "p", files: [] },
      { description: "p", files: {} },
      { description: "p", files: { "a.rs": "x" } },
      { description: "p", files: { "a/b.rs": { content: "x" } } },
      { description: 3, files: FILES },
    ];
    for (const body of bodies) {
      const { status } = await call(makeReq({ body }), d);
      assert.equal(status, 400, JSON.stringify(body));
    }
    assert.equal(calls.createGist.length, 0);
  });

  it("413s a gist over the size or file limit", async () => {
    const { deps: d, calls } = deps();
    const big = { "a.rs": { content: "x".repeat(4 * 1024 * 1024 + 1) } };
    const many = {};
    for (let i = 0; i < 302; i++) many[`f${i}.rs`] = { content: "x" };

    for (const files of [big, many]) {
      const { status } = await call(
        makeReq({ body: { description: "p", files } }),
        d
      );
      assert.equal(status, 413);
    }
    assert.equal(calls.createGist.length, 0);
  });

  it("401s github-unauthorized when the user has no GitHub grant", async () => {
    const { deps: d, calls } = deps({
      getAccessToken: async () => {
        throw new NoGithubGrant("ACCOUNT_NOT_FOUND");
      },
    });

    const { status, body } = await call(makeReq(), d);

    assert.equal(status, 401);
    assert.equal(body.reason, "github-unauthorized");
    assert.equal(calls.createGist.length, 0);
  });

  it("503s when the token cannot be read for a reason of ours", async () => {
    const { deps: d, calls } = deps({
      getAccessToken: async () => {
        throw new Error("connection refused");
      },
    });

    const { status, body } = await call(makeReq(), d);

    assert.equal(status, 503);
    assert.equal(body.reason, undefined);
    assert.equal(calls.createGist.length, 0);
  });

  it("takes a gist at the limits: 300 files plus the manifest, 4 MB of multibyte text", async () => {
    const { deps: d, calls } = deps();
    const many = { ".playground.json": { content: "{}" } };
    for (let i = 0; i < 300; i++) many[`f${i}.rs`] = { content: "x" };
    // 2 bytes each: 2 MB of characters is the whole 4 MB
    const wide = {
      "a.rs": { content: "é".repeat((4 * 1024 * 1024) / 2) },
    };

    for (const files of [many, wide]) {
      const { status } = await call(
        makeReq({ body: { description: "p", files } }),
        d
      );
      assert.equal(status, 201);
    }
    const over = {
      "a.rs": { content: "é".repeat((4 * 1024 * 1024) / 2) + "x" },
    };
    const { status } = await call(
      makeReq({ body: { description: "p", files: over } }),
      d
    );
    assert.equal(status, 413);
    assert.equal(calls.createGist.length, 2);
  });

  it("400s a description over 200 characters", async () => {
    const { deps: d } = deps();
    const { status } = await call(
      makeReq({ body: { description: "x".repeat(201), files: FILES } }),
      d
    );
    assert.equal(status, 400);
  });

  it("passes GitHub's verdict through as createGist mapped it", async () => {
    for (const [status, reason] of [
      [403, "needs-gist-scope"],
      [401, "github-unauthorized"],
      [429, "rate-limited"],
      [422, "rejected"],
      [502, "request-failed"],
    ]) {
      const { deps: d } = deps({
        createGist: async () => ({ status, body: { reason } }),
      });
      const answer = await call(makeReq(), d);
      assert.equal(answer.status, status);
      assert.equal(answer.body.reason, reason);
    }
  });
});
