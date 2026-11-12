import type { Page } from "@playwright/test";

import {
  expect,
  json,
  LONG,
  reloadAndBoot,
  seedWorkspace,
  test,
} from "./fixtures";

const SKILL = {
  id: "e2e-skill",
  name: "E2E skill",
  description: "A skill to switch off.",
  enabled: true,
  source: {
    type: "remote",
    baseUrl: "https://skills.test/",
    entry: "SKILL.md",
  },
};
const TOKEN = "e2e-token-value";
const HEADER = "e2e-header-value";
const ENTRY = [
  {
    id: "mine",
    name: "My server",
    url: "https://mcp.test/mcp",
    authToken: TOKEN,
    headers: { "x-key": HEADER },
  },
];

const openSources = async (page: Page) => {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /Sources and tools/ }).click();
};

/** Every stored value holding the file, read from IndexedDB itself, so a credential anywhere would show */
const readStored = (page: Page) =>
  page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    const contents: string[] = [];
    for (const { name } of dbs) {
      if (!name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      for (const storeName of Array.from(db.objectStoreNames)) {
        const values = await new Promise<unknown[]>((resolve, reject) => {
          const all = db.transaction(storeName).objectStore(storeName).getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => reject(all.error);
        });
        for (const value of values) {
          contents.push(
            value instanceof Uint8Array
              ? new TextDecoder().decode(value)
              : JSON.stringify(value)
          );
        }
      }
      db.close();
    }
    return contents.filter((text) => text.includes('"mcpServers"'));
  });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/mcp", (r) => json(r, { servers: [] }));
  await page.route("**/api/skills", (r) => json(r, { skills: [SKILL] }));
  // Nothing real behind the entry; a failed listing is a fact about the server
  await page.route("https://mcp.test/**", (r) => r.abort());
});

test("assistant-tool-config: A reload after turning a skill off and adding a server", async ({
  page,
}) => {
  await seedWorkspace(page);
  await openSources(page);

  const box = page.getByRole("checkbox", { name: "E2E skill" });
  await expect(box).toBeChecked(LONG);
  await box.click();
  await page.getByRole("button", { name: "Additional servers" }).click();
  await page
    .getByRole("textbox", { name: "MCP server configuration" })
    .fill(JSON.stringify(ENTRY));
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "My server" })).toBeVisible();

  await expect.poll(() => readStored(page).then((f) => f.length)).toBe(1);
  await reloadAndBoot(page);
  await openSources(page);

  await expect(
    page.getByRole("checkbox", { name: "E2E skill" })
  ).not.toBeChecked(LONG);
  await expect(page.getByRole("checkbox", { name: "My server" })).toBeVisible();
});

test("assistant-tool-config: The stored file after adding a server with a token", async ({
  page,
}) => {
  await seedWorkspace(page);
  await openSources(page);
  await page.getByRole("button", { name: "Additional servers" }).click();
  await page
    .getByRole("textbox", { name: "MCP server configuration" })
    .fill(JSON.stringify(ENTRY));
  await page.getByRole("button", { name: "Apply", exact: true }).click();

  await expect.poll(() => readStored(page).then((f) => f.length)).toBe(1);
  const before = (await readStored(page)).join();
  expect(before).toContain('"mine"');
  expect(before).not.toContain(TOKEN);
  expect(before).not.toContain(HEADER);

  await reloadAndBoot(page);
  await openSources(page);

  await expect(page.getByText(/Enter again for/)).toContainText(
    "authToken, headers",
    LONG
  );
  const after = (await readStored(page)).join();
  expect(after).not.toContain(TOKEN);
  expect(after).not.toContain(HEADER);
  await expect(
    page.getByRole("textbox", { name: "MCP server configuration" })
  ).not.toHaveValue(new RegExp(TOKEN));
});
