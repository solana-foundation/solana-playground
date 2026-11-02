import type { Page, Route } from "@playwright/test";
import { expect, json, LONG, seedWorkspace, test } from "./fixtures";

const SERVER = "https://mcp.test/mcp";
const SECRET = "e2e-bypass";
// PROTECTION_PROVIDERS.vercel.query, as a literal: Playwright compiles e2e as CommonJS and cannot load the .mjs
const BYPASS = "x-vercel-protection-bypass";

const ENTRY = [
  {
    id: "protected",
    name: "Protected test server",
    url: SERVER,
    protection: { provider: "vercel", secret: SECRET },
  },
];

// The fulfilled answers are cross-origin, so they need the headers a real server would send
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "mcp-session-id",
};

const rpc = (route: Route, id: unknown, result: unknown) =>
  route.fulfill({
    status: 200,
    headers: {
      "access-control-allow-origin": CORS["access-control-allow-origin"],
      "access-control-allow-methods": CORS["access-control-allow-methods"],
      "access-control-allow-headers": CORS["access-control-allow-headers"],
      "access-control-expose-headers": CORS["access-control-expose-headers"],
      "content-type": "application/json",
      "mcp-session-id": "s1",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, result }),
  });

interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
}

/** A Streamable HTTP MCP server with one tool, `ping`, recording every request */
const stubServer = async (page: Page) => {
  const requests: Recorded[] = [];
  await page.route("https://mcp.test/**", async (route) => {
    const request = route.request();
    requests.push({
      method: request.method(),
      url: request.url(),
      headers: await request.allHeaders(),
    });
    if (request.method() === "OPTIONS" || request.method() === "DELETE") {
      return route.fulfill({ status: 204, headers: CORS });
    }
    // The client's GET opens a stream for server messages; 405 is the transport's answer for a server without one
    if (request.method() === "GET") {
      return route.fulfill({ status: 405, headers: CORS });
    }
    const message = request.postDataJSON();
    if (message.id === undefined) {
      return route.fulfill({ status: 202, headers: CORS });
    }
    if (message.method === "initialize") {
      return rpc(route, message.id, {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "e2e", version: "1" },
      });
    }
    if (message.method === "tools/list") {
      return rpc(route, message.id, {
        tools: [
          {
            name: "ping",
            description: "Answers pong.",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      });
    }
    return rpc(route, message.id, {
      content: [{ type: "text", text: "pong" }],
      isError: false,
    });
  });
  return requests;
};

test("client-v2-sources: A protected server added in the browser", async ({
  page,
}) => {
  // No gateway servers, so the list holds only the entry under test and nothing reaches a real upstream
  await page.route("**/api/mcp", (r) => json(r, { servers: [] }));
  const requests = await stubServer(page);
  await seedWorkspace(page);

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /Sources and tools/ }).click();
  await page.getByRole("button", { name: "Additional servers" }).click();
  await page
    .getByRole("textbox", { name: "MCP server configuration" })
    .fill(JSON.stringify(ENTRY));
  await page.getByRole("button", { name: "Apply", exact: true }).click();

  const box = page.getByRole("checkbox", { name: "Protected test server" });
  await expect(box).toBeChecked();
  const row = page.locator('[data-slot="field"]', { has: box });
  await row.getByRole("button", { name: "Call a tool" }).click();
  await row.locator("#mcp-tool-protected").selectOption("ping", LONG);
  await row.getByRole("button", { name: "Call", exact: true }).click();
  await expect(row.locator("pre", { hasText: "pong" })).toBeVisible(LONG);

  const sent = requests.filter((r) => r.method !== "OPTIONS");
  expect(sent.length).toBeGreaterThan(0);
  for (const request of sent) {
    expect(new URL(request.url).searchParams.get(BYPASS)).toBe(SECRET);
    expect(request.headers[BYPASS]).toBeUndefined();
  }
});
