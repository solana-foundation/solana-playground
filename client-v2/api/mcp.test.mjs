import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import handler from "./mcp.mjs";
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
