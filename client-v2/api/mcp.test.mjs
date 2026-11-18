import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import handler, { callUpstream } from "./mcp.mjs";
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

  it("Two servers through the override", async () => {
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

  it("The override is not JSON: 500 naming SOURCES", async () => {
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

  it("An upstream that never answers is cut at the timeout", async () => {
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

  it("A request body over the cap is refused with 413", async () => {
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

  it("An upstream response over the cap is refused", async () => {
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

  it("A normal call still returns the upstream's answer", async () => {
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

  it("An upstream error quoting the credentials reaches the caller without them", async () => {
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

    const error = await callUpstream(upstream, {}, limits).then(
      () => assert.fail("expected a rejection"),
      (e) => e
    );

    assert.match(error.message, /^401 Unauthorized: bad credentials/);
    for (const secret of secrets) {
      assert.ok(!error.message.includes(secret), `leaked ${secret}`);
    }
    assert.match(error.message, /\[redacted\]/);
  });

  it("A network error naming the URL is redacted too", async () => {
    mock.method(global, "fetch", async (url) => {
      throw new Error(`connect ECONNREFUSED ${url}`);
    });

    const error = await callUpstream(upstream, {}, limits).then(
      () => assert.fail("expected a rejection"),
      (e) => e
    );

    for (const secret of secrets) {
      assert.ok(!error.message.includes(secret), `leaked ${secret}`);
    }
  });
});
