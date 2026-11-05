import type { Page, Route } from "@playwright/test";

import { expect, test } from "./fixtures";

/**
 * The scenarios of `client-v2-custom-rpcs`: several custom RPCs saved in
 * Settings, Network, picked as chips beside Devnet and Mainnet.
 */

/** Devnet's genesis hash, so a stubbed RPC reads as devnet */
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

const RESULTS: Record<string, unknown> = {
  getGenesisHash: DEVNET_GENESIS,
  getVersion: { "solana-core": "2.0.0", "feature-set": 0 },
  getBalance: { context: { slot: 1 }, value: 0 },
  getSlot: 1,
};

/** Answers every JSON-RPC call to `*.rpc.test`, and records the hosts asked */
const stubRpcs = async (page: Page) => {
  const asked: string[] = [];
  const answer = (call: { id?: unknown; method?: string }) => ({
    jsonrpc: "2.0",
    id: call.id,
    // JSON-RPC answers an unknown call with a null result, not none
    // eslint-disable-next-line unicorn/no-null -- the wire format's null
    result: RESULTS[call.method ?? ""] ?? null,
  });
  await page.route("https://*.rpc.test/**", async (route: Route) => {
    asked.push(new URL(route.request().url()).host);
    const body = route.request().postDataJSON() ?? {};
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        Array.isArray(body) ? body.map(answer) : answer(body)
      ),
    });
  });
  return asked;
};

const openSettings = async (page: Page) => {
  await page.getByRole("button", { name: /^Change cluster/ }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await expect(settings).toBeVisible();
  return settings;
};

const network = (page: Page) =>
  page
    .getByRole("region", { name: "Settings" })
    .getByRole("radiogroup", { name: "Network" });

const addRpc = async (
  page: Page,
  { name, url }: { name: string; url: string }
) => {
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Add custom RPC" }).click();
  // The Block Explorer section has a row called Name too
  const form = settings.getByRole("form", { name: "Add custom RPC" });
  if (name) await form.getByLabel("Name").fill(name);
  await form.getByLabel("RPC URL").fill(url);
  await form.getByLabel("RPC URL").press("Enter");
};

test.beforeEach(async ({ seededPage: page }) => {
  await stubRpcs(page);
});

test("client-v2-custom-rpcs: Two saved RPCs survive a reload", async ({
  seededPage: page,
}) => {
  await openSettings(page);
  await addRpc(page, {
    name: "Helius",
    url: "https://helius.rpc.test/?api-key=k",
  });
  await addRpc(page, { name: "Triton", url: "https://triton.rpc.test/" });
  await expect(network(page).getByRole("radio")).toHaveText([
    "Devnet",
    "Mainnet",
    "Helius",
    "Triton",
  ]);

  await page.reload();
  await openSettings(page);
  await expect(network(page).getByRole("radio")).toHaveText([
    "Devnet",
    "Mainnet",
    "Helius",
    "Triton",
  ]);
  await expect(
    network(page).getByRole("radio", { name: "Triton" })
  ).toHaveAttribute("aria-checked", "true");
});

test("client-v2-custom-rpcs: Picking a custom chip moves the connection", async ({
  seededPage: page,
}) => {
  const asked = await stubRpcs(page);
  await openSettings(page);
  await addRpc(page, { name: "Helius", url: "https://helius.rpc.test/" });
  await addRpc(page, { name: "Triton", url: "https://triton.rpc.test/" });
  await network(page).getByRole("radio", { name: "Helius" }).click();
  // The last host asked: the connection keeps polling the picked RPC, so a
  // request to the other one still in flight is overtaken
  await expect.poll(() => asked.at(-1)).toBe("helius.rpc.test");
});

test("client-v2-custom-rpcs: A new RPC is saved and picked", async ({
  seededPage: page,
}) => {
  await openSettings(page);
  await addRpc(page, {
    name: "Helius",
    url: "https://rpc.example.com/?api-key=k",
  });
  await expect(
    network(page).getByRole("radio", { name: "Helius" })
  ).toHaveAttribute("aria-checked", "true");
});

test("client-v2-custom-rpcs: An unnamed RPC is named by its host", async ({
  seededPage: page,
}) => {
  await openSettings(page);
  await addRpc(page, { name: "", url: "https://rpc.example.com/v1/k" });
  await expect(
    network(page).getByRole("radio", { name: "rpc.example.com" })
  ).toBeVisible();
});

test("client-v2-custom-rpcs: A value that is not an https URL is refused", async ({
  seededPage: page,
}) => {
  const settings = await openSettings(page);
  for (const value of ["devnet", "http://api.devnet.solana.com"]) {
    await addRpc(page, { name: "", url: value });
    await expect(
      settings.getByText(
        "Enter a URL that starts with https://, or http:// for a local validator."
      )
    ).toBeVisible();
    await settings.getByRole("button", { name: "Cancel" }).click();
  }
  await expect(network(page).getByRole("radio")).toHaveText([
    "Devnet",
    "Mainnet",
  ]);
});

test("client-v2-custom-rpcs: A local validator over plain HTTP is accepted", async ({
  seededPage: page,
}) => {
  await page.route("http://localhost:8899/**", (route) =>
    route.abort("connectionrefused")
  );
  await openSettings(page);
  await addRpc(page, { name: "Local", url: "http://localhost:8899" });
  await expect(
    network(page).getByRole("radio", { name: "Local" })
  ).toHaveAttribute("aria-checked", "true");
});

test("client-v2-custom-rpcs: A duplicate URL is refused", async ({
  seededPage: page,
}) => {
  const settings = await openSettings(page);
  await addRpc(page, { name: "Helius", url: "https://helius.rpc.test/" });
  await addRpc(page, { name: "Again", url: "https://HELIUS.rpc.test" });
  await expect(settings.getByText("Already saved as Helius.")).toBeVisible();
});

test("client-v2-custom-rpcs: The key in a URL is never drawn", async ({
  seededPage: page,
}) => {
  const settings = await openSettings(page);
  await addRpc(page, {
    name: "Helius",
    url: "https://helius.rpc.test/?api-key=secret",
  });
  await expect(
    settings.getByRole("list", { name: "Custom RPCs" })
  ).toContainText("helius.rpc.test");
  await expect(page.locator("body")).not.toContainText("secret");
});

test("client-v2-custom-rpcs: Editing renames the chip", async ({
  seededPage: page,
}) => {
  const asked = await stubRpcs(page);
  const settings = await openSettings(page);
  await addRpc(page, { name: "Helius", url: "https://helius.rpc.test/" });
  await settings.getByRole("button", { name: "Edit Helius" }).click();
  const form = settings.getByRole("form", { name: "Edit Helius" });
  await form.getByLabel("Name").fill("Triton");
  await form.getByLabel("RPC URL").fill("https://triton.rpc.test/");
  await form.getByLabel("RPC URL").press("Enter");
  await expect(
    network(page).getByRole("radio", { name: "Triton" })
  ).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => asked.at(-1)).toBe("triton.rpc.test");
});

test("client-v2-custom-rpcs: Removing the picked RPC lands on Devnet", async ({
  seededPage: page,
}) => {
  const settings = await openSettings(page);
  await addRpc(page, { name: "Helius", url: "https://helius.rpc.test/" });
  await settings.getByRole("button", { name: "Remove Helius" }).click();
  await expect(
    network(page).getByRole("radio", { name: "Devnet", exact: true })
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByText("Removed Helius. Network is Devnet now.")
  ).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(
    network(page).getByRole("radio", { name: "Helius" })
  ).toHaveAttribute("aria-checked", "true");
});

test("client-v2-custom-rpcs: A custom endpoint from before is listed", async ({
  seededPage: page,
}) => {
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem("settings") ?? "{}");
    settings.connection = settings.connection ?? {};
    settings.connection.endpoint = {
      option: "custom",
      // Without the trailing slash the listed URL gains
      url: "https://own.rpc.test",
    };
    localStorage.setItem("settings", JSON.stringify(settings));
    localStorage.removeItem("customRpcs");
  });
  await page.reload();
  await openSettings(page);
  await expect(
    network(page).getByRole("radio", { name: "own.rpc.test" })
  ).toHaveAttribute("aria-checked", "true");
});

test("client-v2-custom-rpcs: Removing an RPC not in use keeps the network", async ({
  seededPage: page,
}) => {
  const settings = await openSettings(page);
  await addRpc(page, { name: "Helius", url: "https://helius.rpc.test/" });
  await addRpc(page, { name: "Triton", url: "https://triton.rpc.test/" });
  await settings.getByRole("button", { name: "Remove Helius" }).click();
  await expect(
    page.getByText("Removed Helius.", { exact: true })
  ).toBeVisible();
  await expect(
    network(page).getByRole("radio", { name: "Triton" })
  ).toHaveAttribute("aria-checked", "true");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(network(page).getByRole("radio")).toHaveText([
    "Devnet",
    "Mainnet",
    "Helius",
    "Triton",
  ]);
  await expect(
    network(page).getByRole("radio", { name: "Triton" })
  ).toHaveAttribute("aria-checked", "true");
});
