import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGist } from "./create-gist.mjs";

const TOKEN = "gho_secret";
const FILES = { "src__lib.rs": { content: "x" } };

/** A `fetch` that answers once with the given status, headers and body */
const answering = (status, { headers = {}, body = {} } = {}) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers });
  };
  return { fetch, calls };
};

const run = (fetch) =>
  createGist({ token: TOKEN, description: "counter", files: FILES, fetch });

describe("features/gist/model/create-gist", () => {
  it("creates a public gist and answers its url and id", async () => {
    const github = answering(201, {
      body: { id: "abc", html_url: "https://gist.github.com/ada/abc" },
    });

    const result = await run(github.fetch);

    assert.deepEqual(result, {
      status: 201,
      body: { url: "https://gist.github.com/ada/abc", id: "abc" },
    });
    const [{ url, init }] = github.calls;
    assert.equal(url, "https://api.github.com/gists");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(JSON.parse(init.body), {
      description: "counter",
      public: true,
      files: FILES,
    });
  });

  it("reads a 404 from a token without the gist scope as needs-gist-scope", async () => {
    const github = answering(404, {
      headers: { "x-oauth-scopes": "read:user, user:email" },
    });

    assert.deepEqual(await run(github.fetch), {
      status: 403,
      body: { reason: "needs-gist-scope" },
    });
  });

  it("reads a 403 without the gist scope the same way", async () => {
    const github = answering(403, {
      headers: { "x-oauth-scopes": "read:user", "x-ratelimit-remaining": "40" },
    });

    assert.equal((await run(github.fetch)).body.reason, "needs-gist-scope");
  });

  it("does not blame the scope for a 404 when the token has it", async () => {
    const github = answering(404, {
      headers: { "x-oauth-scopes": "gist, read:user" },
    });

    assert.deepEqual(await run(github.fetch), {
      status: 502,
      body: { reason: "request-failed" },
    });
  });

  it("answers 429 for a 403 with no requests left, not needs-gist-scope", async () => {
    const github = answering(403, {
      headers: { "x-oauth-scopes": "read:user", "x-ratelimit-remaining": "0" },
    });

    assert.deepEqual(await run(github.fetch), {
      status: 429,
      body: { reason: "rate-limited" },
    });
  });

  it("answers 429 for GitHub's secondary rate limit", async () => {
    const github = answering(403, {
      headers: { "x-oauth-scopes": "gist", "retry-after": "60" },
      body: { message: "You have exceeded a secondary rate limit." },
    });

    assert.equal((await run(github.fetch)).status, 429);
  });

  it("answers 429 for a 429", async () => {
    assert.equal((await run(answering(429).fetch)).status, 429);
  });

  it("answers github-unauthorized for a revoked token", async () => {
    assert.deepEqual(await run(answering(401).fetch), {
      status: 401,
      body: { reason: "github-unauthorized" },
    });
  });

  it("answers 422 when GitHub rejects the gist", async () => {
    const github = answering(422, { body: { message: "Validation Failed" } });

    assert.deepEqual(await run(github.fetch), {
      status: 422,
      body: { reason: "rejected" },
    });
  });

  it("answers 502 for a GitHub failure or a network error", async () => {
    assert.equal((await run(answering(500).fetch)).status, 502);

    const result = await run(async () => {
      throw new TypeError("fetch failed");
    });
    assert.deepEqual(result, {
      status: 502,
      body: { reason: "request-failed" },
    });
  });

  it("answers 502 when a 201 carries no gist url", async () => {
    assert.equal((await run(answering(201, { body: {} }).fetch)).status, 502);
  });

  it("never puts the token in an answer", async () => {
    for (const status of [201, 401, 403, 404, 422, 429, 500]) {
      const result = await run(
        answering(status, { body: { token: TOKEN } }).fetch
      );
      assert.ok(!JSON.stringify(result).includes(TOKEN), `status ${status}`);
    }
  });
});
