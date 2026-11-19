import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import handler, { callUpstream, handleWith } from "./mcp.mjs";
import skillsHandler from "./skills.mjs";

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

/** A request as the platform hands it over, with the body pre-parsed */
const request = (method, url, body) => ({ method, url, headers: {}, body });

describe("/api/mcp with SOURCES", () => {
  // `yarn test-api` loads `.env`, which may set the override these cases control
  beforeEach(() => {
    process.env.SOURCES = JSON.stringify([
      { kind: "mcp", id: "a", name: "A", url: "https://a.test/mcp" },
      { kind: "mcp", id: "b", name: "B", url: "https://b.test/mcp" },
    ]);
  });
  afterEach(() => {
    delete process.env.SOURCES;
    mock.restoreAll();
  });

  it("merges two servers from the override", async () => {
    // Each upstream answers with one tool named after its host
    mock.method(global, "fetch", async (url, init) => {
      const { id } = JSON.parse(init.body);
      const tool = new URL(url).host.split(".")[0];
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: { tools: [{ name: `search_${tool}` }] },
        }),
        { headers: { "content-type": "application/json" } }
      );
    });

    const listed = makeRes();
    await handler(request("GET", "/api/mcp"), listed);
    const tools = makeRes();
    await handler(
      request("POST", "/api/mcp", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
      tools
    );
    const skills = makeRes();
    await skillsHandler(request("GET", "/api/skills"), skills);

    assert.deepEqual(JSON.parse(listed.body).servers, [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ]);
    assert.deepEqual(
      JSON.parse(tools.body).result.tools.map((tool) => tool.name),
      ["a__search_a", "b__search_b"]
    );
    assert.deepEqual(JSON.parse(skills.body).skills, []);
  });

  it("answers 500 naming SOURCES when the override is not JSON", async () => {
    process.env.SOURCES = "[{";

    const res = makeRes();
    await handler(request("GET", "/api/mcp"), res);

    assert.equal(res.statusCode, 500);
    assert.match(JSON.parse(res.body).error, /^SOURCES /);
  });
});

describe("/api/mcp limits", () => {
  beforeEach(() => {
    process.env.SOURCES = JSON.stringify([
      { kind: "mcp", id: "a", name: "A", url: "https://a.test/mcp" },
    ]);
  });
  afterEach(() => {
    delete process.env.SOURCES;
    delete process.env.MCP_TIMEOUT_MS;
    delete process.env.MCP_MAX_REQUEST_BYTES;
    delete process.env.MCP_MAX_RESPONSE_BYTES;
    mock.restoreAll();
  });

  /** A `tools/call` request, id 7 */
  const toolsCall = (params) => ({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params,
  });

  it("cuts an upstream that never answers at the timeout", async () => {
    process.env.MCP_TIMEOUT_MS = "50";
    // Answers only when aborted, as fetch does
    mock.method(
      global,
      "fetch",
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(init.signal.reason)
          );
        })
    );

    const res = makeRes();
    const started = Date.now();
    await handler(request("POST", "/api/mcp", toolsCall({ name: "x" })), res);

    assert.ok(Date.now() - started < 2000);
    const body = JSON.parse(res.body);
    assert.equal(body.id, 7);
    assert.equal(body.error.code, -32603);
    assert.match(body.error.message, /did not answer within 50 ms/);
  });

  it("refuses a request body over the cap with 413", async () => {
    process.env.MCP_MAX_REQUEST_BYTES = "100";
    const fetchMock = mock.method(global, "fetch", async () => {
      throw new Error("must not be called");
    });

    const res = makeRes();
    await handler(
      request(
        "POST",
        "/api/mcp",
        toolsCall({ name: "x", arguments: { q: "y".repeat(200) } })
      ),
      res
    );

    assert.equal(res.statusCode, 413);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it("refuses an upstream response over the cap", async () => {
    process.env.MCP_MAX_RESPONSE_BYTES = "100";
    mock.method(
      global,
      "fetch",
      async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: "z".repeat(500) }),
          { headers: { "content-type": "application/json" } }
        )
    );

    const res = makeRes();
    await handler(request("POST", "/api/mcp", toolsCall({ name: "x" })), res);

    const body = JSON.parse(res.body);
    assert.equal(body.error.code, -32603);
    assert.match(body.error.message, /larger than 100 bytes/);
  });

  it("refuses unread a response declaring a length over the cap", async () => {
    process.env.MCP_MAX_RESPONSE_BYTES = "100";
    mock.method(
      global,
      "fetch",
      async () =>
        new Response("{}", {
          headers: {
            "content-type": "application/json",
            "content-length": "99999",
          },
        })
    );

    const res = makeRes();
    await handler(request("POST", "/api/mcp", toolsCall({ name: "x" })), res);

    assert.match(JSON.parse(res.body).error.message, /larger than 100 bytes/);
  });

  it("refuses a streamed response once its chunks pass the cap", async () => {
    process.env.MCP_MAX_RESPONSE_BYTES = "100";
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(40)));
      },
      cancel() {
        cancelled = true;
      },
    });
    mock.method(
      global,
      "fetch",
      async () =>
        new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        })
    );

    const res = makeRes();
    await handler(request("POST", "/api/mcp", toolsCall({ name: "x" })), res);

    assert.match(JSON.parse(res.body).error.message, /larger than 100 bytes/);
    assert.ok(cancelled);
  });

  it("reports the status of an oversized error page", async () => {
    process.env.MCP_MAX_RESPONSE_BYTES = "100";
    mock.method(
      global,
      "fetch",
      async () =>
        new Response("<html>".repeat(100), {
          status: 502,
          statusText: "Bad Gateway",
        })
    );

    const res = makeRes();
    await handler(request("POST", "/api/mcp", toolsCall({ name: "x" })), res);

    assert.match(
      JSON.parse(res.body).error.message,
      /^502 Bad Gateway: Upstream response is larger than 100 bytes/
    );
  });

  it("cuts a body that stalls after the headers at the timeout", async () => {
    process.env.MCP_TIMEOUT_MS = "50";
    mock.method(global, "fetch", async (_url, init) => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: {"));
          init.signal.addEventListener("abort", () =>
            controller.error(init.signal.reason)
          );
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      });
    });

    const res = makeRes();
    await handler(request("POST", "/api/mcp", toolsCall({ name: "x" })), res);

    assert.match(
      JSON.parse(res.body).error.message,
      /did not answer within 50 ms/
    );
  });

  it("unwraps an event-stream answer as before", async () => {
    mock.method(
      global,
      "fetch",
      async () =>
        new Response(
          'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[]}}\n\n',
          { headers: { "content-type": "text/event-stream" } }
        )
    );

    const res = makeRes();
    await handler(request("POST", "/api/mcp", toolsCall({ name: "x" })), res);

    assert.deepEqual(JSON.parse(res.body), {
      jsonrpc: "2.0",
      id: 7,
      result: { content: [] },
    });
  });

  it("falls back to the default for a zero bound", async () => {
    process.env.MCP_MAX_REQUEST_BYTES = "0";
    mock.method(
      global,
      "fetch",
      async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
          headers: { "content-type": "application/json" },
        })
    );

    const res = makeRes();
    await handler(request("POST", "/api/mcp", toolsCall({ name: "x" })), res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body).result, {});
  });

  it("returns the upstream's answer to a normal call", async () => {
    process.env.MCP_TIMEOUT_MS = "1000";
    mock.method(global, "fetch", async (_url, init) => {
      const { id } = JSON.parse(init.body);
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id, result: { content: [] } }),
        { headers: { "content-type": "application/json" } }
      );
    });

    const res = makeRes();
    await handler(request("POST", "/api/mcp", toolsCall({ name: "x" })), res);

    assert.deepEqual(JSON.parse(res.body), {
      jsonrpc: "2.0",
      id: 7,
      result: { content: [] },
    });
  });
});

describe("callUpstream redaction", () => {
  afterEach(() => mock.restoreAll());

  const upstream = {
    id: "a",
    url: "https://a.test/mcp?api-key=urlkey-1234567890",
    authToken: "token-abcdefghijklmnop",
    headers: { "x-api-key": "header-key-0987654321" },
    queryParams: { key: "query-key-1122334455" },
    protection: { provider: "vercel", secret: "bypass-secret-99887766" },
  };
  const limits = { timeoutMs: 1000, maxResponseBytes: 100000 };
  const secrets = [
    "urlkey-1234567890",
    "token-abcdefghijklmnop",
    "header-key-0987654321",
    "query-key-1122334455",
    "bypass-secret-99887766",
  ];

  it("removes the credentials an upstream error quotes", async () => {
    mock.method(global, "fetch", async (url, init) => {
      const echoed = [
        String(url),
        init.headers.authorization,
        init.headers["x-api-key"],
        init.headers["x-vercel-protection-bypass"],
      ].join(" ");
      return new Response(`bad credentials: ${echoed}`, {
        status: 401,
        statusText: "Unauthorized",
      });
    });

    const error = await callUpstream(limits, upstream, {}).then(
      () => assert.fail("expected a rejection"),
      (e) => e
    );

    assert.match(error.message, /^401 Unauthorized: bad credentials/);
    for (const secret of secrets) {
      assert.ok(!error.message.includes(secret), `leaked ${secret}`);
    }
    assert.match(error.message, /\[redacted\]/);
  });

  it("removes a credential quoted percent-encoded", async () => {
    const encoded = {
      id: "a",
      url: "https://a.test/mcp",
      queryParams: { key: "key+with/odd=chars 42" },
    };
    mock.method(global, "fetch", async (url) => {
      throw new Error(`connect ECONNREFUSED ${url}`);
    });

    const error = await callUpstream(limits, encoded, {}).then(
      () => assert.fail("expected a rejection"),
      (e) => e
    );

    assert.ok(!error.message.includes("odd"), error.message);
  });

  it("removes a credential the 200-character cut of an error page falls inside", async () => {
    mock.method(global, "fetch", async (_url, init) => {
      // The cut leaves the token's first six characters, shorter than a run
      const quoted = `${"x".repeat(194)}${init.headers.authorization.slice(7)}`;
      return new Response(quoted, { status: 500, statusText: "Internal" });
    });

    const error = await callUpstream(limits, upstream, {}).then(
      () => assert.fail("expected a rejection"),
      (e) => e
    );

    assert.ok(!error.message.includes("token-"), error.message);
  });

  it("leaves no part of a credential near the cut wherever it falls", async () => {
    // A credential masked early shortens the page, pulling later text over
    // the cut. The token shares no character with the page or `[redacted]`,
    // so any of its characters in the message is a leak.
    const token = "QZX7-QZX7-QZX7-QZX7-QZX7";
    const quoting = { id: "a", url: "https://a.test/mcp", authToken: token };
    for (let gap = 150; gap <= 260; gap += 1) {
      mock.method(global, "fetch", async () => {
        return new Response(`${token}${"y".repeat(gap)}${token}`, {
          status: 500,
          statusText: "Internal",
        });
      });

      const error = await callUpstream(limits, quoting, {}).then(
        () => assert.fail("expected a rejection"),
        (e) => e
      );

      assert.ok(!/[QZX7]/.test(error.message), `gap ${gap}: ${error.message}`);
      mock.restoreAll();
    }
  });

  it("redacts a large error page against a long credential quickly", async () => {
    const long = {
      id: "a",
      url: "https://a.test/mcp",
      authToken: "t".repeat(1) + "k9".repeat(512),
    };
    mock.method(global, "fetch", async () => {
      return new Response("z".repeat(2 * 1024 * 1024), {
        status: 500,
        statusText: "Internal",
      });
    });

    const started = performance.now();
    await callUpstream(
      { timeoutMs: 5000, maxResponseBytes: 4 * 1024 * 1024 },
      long,
      {}
    ).catch(() => {});

    assert.ok(performance.now() - started < 1000, "took over a second");
  });

  it("removes the whole query form of a value with a space and reserved characters", async () => {
    const spaced = {
      id: "a",
      url: "https://a.test/mcp",
      queryParams: { key: "qry Charlie9/sec+ret&" },
    };
    mock.method(global, "fetch", async (url) => {
      return new Response(`not found: ${url}`, {
        status: 404,
        statusText: "Not Found",
      });
    });

    const error = await callUpstream(limits, spaced, {}).then(
      () => assert.fail("expected a rejection"),
      (e) => e
    );

    assert.ok(!error.message.includes("qry"), error.message);
  });

  it("removes a credential from a parse error quoting the body", async () => {
    mock.method(
      global,
      "fetch",
      async () =>
        new Response("not json token-abcdefghijklmnop", {
          headers: { "content-type": "application/json" },
        })
    );

    const error = await callUpstream(limits, upstream, {}).then(
      () => assert.fail("expected a rejection"),
      (e) => e
    );

    assert.ok(!error.message.includes("token-abcdefghijklmnop"));
  });

  it("removes the credentials from a JSON-RPC error answered with HTTP 200", async () => {
    mock.method(
      global,
      "fetch",
      async (_url, init) =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: {
              code: -32001,
              message: `refused ${init.headers.authorization}`,
              data: { sent: [init.headers["x-api-key"]], count: 1234 },
              hint: init.headers["x-vercel-protection-bypass"],
            },
          }),
          { headers: { "content-type": "application/json" } }
        )
    );

    const answer = await callUpstream(limits, upstream, {});

    assert.equal(answer.error.code, -32001);
    assert.equal(answer.error.data.count, 1234);
    assert.match(answer.error.message, /^refused /);
    const text = JSON.stringify(answer);
    for (const secret of secrets) {
      assert.ok(!text.includes(secret), `leaked ${secret}`);
    }
  });

  it("returns a result untouched even when it quotes a credential", async () => {
    const result = { content: [{ type: "text", text: "urlkey-1234567890" }] };
    mock.method(
      global,
      "fetch",
      async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
          headers: { "content-type": "application/json" },
        })
    );

    const answer = await callUpstream(limits, upstream, {});

    assert.deepEqual(answer.result, result);
  });

  it("names the timeout when an error page stalls", async () => {
    mock.method(global, "fetch", async (_url, init) => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("<html>"));
          init.signal.addEventListener("abort", () =>
            controller.error(init.signal.reason)
          );
        },
      });
      return new Response(stream, { status: 502, statusText: "Bad Gateway" });
    });

    const error = await callUpstream(
      { timeoutMs: 50, maxResponseBytes: 100000 },
      upstream,
      {}
    ).then(
      () => assert.fail("expected a rejection"),
      (e) => e
    );

    assert.match(error.message, /did not answer within 50 ms/);
  });

  it("removes the token of a header value with a scheme", async () => {
    const schemed = {
      id: "a",
      url: "https://a.test/mcp",
      headers: { authorization: "Basic dXNlcjpzZWNyZXQ0Mg" },
    };
    mock.method(
      global,
      "fetch",
      async () =>
        new Response("bad credentials dXNlcjpzZWNyZXQ0Mg", {
          status: 401,
          statusText: "Unauthorized",
        })
    );

    const error = await callUpstream(limits, schemed, {}).then(
      () => assert.fail("expected a rejection"),
      (e) => e
    );

    assert.ok(!error.message.includes("dXNlcjpzZWNyZXQ0Mg"), error.message);
  });

  it("removes the credentials from a network error naming the URL", async () => {
    mock.method(global, "fetch", async (url) => {
      throw new Error(`connect ECONNREFUSED ${url}`);
    });

    const error = await callUpstream(limits, upstream, {}).then(
      () => assert.fail("expected a rejection"),
      (e) => e
    );

    for (const secret of secrets) {
      assert.ok(!error.message.includes(secret), `leaked ${secret}`);
    }
  });
});

describe("/api/mcp with a signed-in caller", () => {
  // The entry's credentials are sent only to a signed-in caller on this site
  const signedIn = handleWith({
    isAllowedOrigin: () => true,
    readSession: async () => ({ status: "signed-in" }),
  });
  const token = "token-abcdefghijklmnop";
  const bypass = "bypass-secret-99887766";

  beforeEach(() => {
    process.env.SOURCES = JSON.stringify([
      {
        kind: "mcp",
        id: "a",
        name: "A",
        url: "https://a.test/mcp",
        authToken: token,
        protection: { provider: "vercel", secret: bypass },
      },
    ]);
  });
  afterEach(() => {
    delete process.env.SOURCES;
    mock.restoreAll();
  });

  it("removes the entry's credentials from an upstream error it relays", async () => {
    const fetchMock = mock.method(
      global,
      "fetch",
      async (_url, init) =>
        new Response(
          `rejected ${init.headers.authorization} ${init.headers["x-vercel-protection-bypass"]}`,
          { status: 403, statusText: "Forbidden" }
        )
    );

    const res = makeRes();
    await signedIn(
      request("POST", "/api/mcp", {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "x" },
      }),
      res
    );

    // The credentials did reach the upstream, so the error had them to quote
    assert.equal(
      fetchMock.mock.calls[0].arguments[1].headers.authorization,
      `Bearer ${token}`
    );
    const body = JSON.parse(res.body);
    assert.equal(body.id, 9);
    assert.match(body.error.message, /^403 Forbidden: rejected/);
    assert.ok(!res.body.includes(token), res.body);
    assert.ok(!res.body.includes(bypass), res.body);
  });
});
