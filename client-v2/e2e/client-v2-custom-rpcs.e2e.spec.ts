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

/**
 * Answers every JSON-RPC call to `*.rpc.test` and the spec's `rpc.example.com`,
 * and records the hosts asked
 */
const stubRpcs = async (page: Page) => {
  const asked: string[] = [];
  const answer = (call: { id?: unknown; method?: string }) => ({
    jsonrpc: "2.0",
    id: call.id,
    // JSON-RPC answers an unknown call with a null result, not none
    // eslint-disable-next-line unicorn/no-null -- the wire format's null
    result: RESULTS[call.method ?? ""] ?? null,
  });
  const handle = async (route: Route) => {
    asked.push(new URL(route.request().url()).host);
    const body = route.request().postDataJSON() ?? {};
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        Array.isArray(body) ? body.map(answer) : answer(body)
      ),
    });
  };
  await page.route("https://*.rpc.test/**", handle);
  await page.route("https://rpc.example.com/**", handle);
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
    "Mainnet",
    "Devnet",
    "Testnet",
    "Localnet",
    "Surfpool",
    "Helius",
    "Triton",
  ]);

  await page.reload();
  await openSettings(page);
  await expect(network(page).getByRole("radio")).toHaveText([
    "Mainnet",
    "Devnet",
    "Testnet",
    "Localnet",
    "Surfpool",
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
    "Mainnet",
    "Devnet",
    "Testnet",
    "Localnet",
    "Surfpool",
  ]);
});

test("client-v2-custom-rpcs: A local validator over plain HTTP is accepted", async ({
  seededPage: page,
}) => {
  await page.route("http://localhost:8899/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" }),
    })
  );
  await openSettings(page);
  await addRpc(page, { name: "Local", url: "http://localhost:8899" });
  await expect(
    network(page).getByRole("radio", { name: "Local", exact: true })
  ).toHaveAttribute("aria-checked", "true");
});

test("client-v2-custom-rpcs: A duplicate URL is refused", async ({
  seededPage: page,
}) => {
  const settings = await openSettings(page);
  await addRpc(page, { name: "Helius", url: "https://helius.rpc.test/" });
  await addRpc(page, { name: "Helius", url: "https://HELIUS.rpc.test" });
  await expect(settings.getByText("Already saved as Helius.")).toBeVisible();
});

test("client-v2-custom-rpcs: A saved URL is accepted under another name", async ({
  seededPage: page,
}) => {
  const settings = await openSettings(page);
  await addRpc(page, { name: "Helius", url: "https://helius.rpc.test/" });
  await addRpc(page, { name: "Helius backup", url: "https://HELIUS.rpc.test" });
  await expect(
    network(page).getByRole("radio", { name: "Helius backup" })
  ).toHaveAttribute("aria-checked", "true");
  await expect(settings.getByText(/Already saved as/)).toHaveCount(0);
});

test("client-v2-custom-rpcs: A key in the query is masked", async ({
  seededPage: page,
}) => {
  const settings = await openSettings(page);
  await addRpc(page, {
    name: "Helius",
    url: "https://helius.rpc.test/?api-key=secret",
  });
  const list = settings.getByRole("list", { name: "Custom RPCs" });
  await expect(list).toContainText("https://helius.rpc.test/?api-key=••••");
  await expect(list.getByText("API key", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("secret");
});

test("client-v2-custom-rpcs: A key in the path is masked", async ({
  seededPage: page,
}) => {
  const settings = await openSettings(page);
  await addRpc(page, {
    name: "Alchemy",
    url: "https://mainnet.rpc.test/v2/abc123def456ghi789",
  });
  const list = settings.getByRole("list", { name: "Custom RPCs" });
  await expect(list).toContainText("https://mainnet.rpc.test/v2/••••");
  await expect(list.getByText("API key", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("abc123def456ghi789");
});

test("client-v2-custom-rpcs: A URL with no key shows in full", async ({
  seededPage: page,
}) => {
  const settings = await openSettings(page);
  await addRpc(page, { name: "Example", url: "https://rpc.example.com/" });
  const list = settings.getByRole("list", { name: "Custom RPCs" });
  await expect(list).toContainText("https://rpc.example.com/");
  await expect(list.getByText("API key", { exact: true })).toHaveCount(0);
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
    "Mainnet",
    "Devnet",
    "Testnet",
    "Localnet",
    "Surfpool",
    "Helius",
    "Triton",
  ]);
  await expect(
    network(page).getByRole("radio", { name: "Triton" })
  ).toHaveAttribute("aria-checked", "true");
});

test("client-v2-custom-rpcs: No endpoint select in Settings", async ({
  seededPage: page,
}) => {
  const settings = await openSettings(page);
  // Commitment, the connection setting that keeps a row, sits in Advanced
  const advanced = settings.getByRole("region", { name: "Advanced" });
  await expect(
    advanced.getByRole("combobox", { name: "Commitment" })
  ).toBeVisible();
  await expect(
    settings.getByRole("combobox", { name: "Endpoint" })
  ).toHaveCount(0);
  await expect(settings.getByText("Endpoint", { exact: true })).toHaveCount(0);
  await network(page).getByRole("radio", { name: "Mainnet" }).click();
  await expect(
    network(page).getByRole("radio", { name: "Mainnet" })
  ).toHaveAttribute("aria-checked", "true");
});

test("client-v2-custom-rpcs: A URL that answers is saved", async ({
  seededPage: page,
}) => {
  // Hold the health request, to see the form while it waits
  let answer = () => {};
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.route("https://slow.rpc.test/**", async (route) => {
    await answered;
    await route.fallback();
  });
  const settings = await openSettings(page);
  await addRpc(page, { name: "Slow", url: "https://slow.rpc.test/" });
  const form = settings.getByRole("form", { name: "Add custom RPC" });
  await expect(form.getByRole("button", { name: /Save/ })).toBeDisabled();
  await expect(form.getByRole("status")).toBeVisible();
  await expect(form.getByLabel("RPC URL")).not.toBeEditable();

  answer();
  await expect(
    network(page).getByRole("radio", { name: "Slow" })
  ).toHaveAttribute("aria-checked", "true");
  await expect(settings.getByText("This URL is not responding.")).toHaveCount(
    0
  );
});

test("client-v2-custom-rpcs: A URL that does not answer offers Use anyway", async ({
  seededPage: page,
}) => {
  await page.route("https://example.invalid/**", (route) =>
    route.abort("namenotresolved")
  );
  const settings = await openSettings(page);
  await addRpc(page, { name: "Dead", url: "https://example.invalid" });
  await expect(settings.getByText("This URL is not responding.")).toBeVisible();
  await expect(network(page).getByRole("radio", { name: "Dead" })).toHaveCount(
    0
  );

  await settings.getByRole("button", { name: "Use anyway" }).click();
  await expect(
    network(page).getByRole("radio", { name: "Dead" })
  ).toHaveAttribute("aria-checked", "true");
});

test("client-v2-custom-rpcs: Offline, nothing is sent", async ({
  seededPage: page,
  context,
}) => {
  const asked = await stubRpcs(page);
  const settings = await openSettings(page);
  await context.setOffline(true);
  await addRpc(page, { name: "Far", url: "https://far.rpc.test/" });
  await expect(
    settings.getByText("You're offline, so this URL can't be checked.")
  ).toBeVisible();
  expect(asked).not.toContain("far.rpc.test");
  await expect(network(page).getByRole("radio", { name: "Far" })).toHaveCount(
    0
  );

  await settings.getByRole("button", { name: "Use anyway" }).click();
  await expect(
    network(page).getByRole("radio", { name: "Far" })
  ).toHaveAttribute("aria-checked", "true");
});

test("client-v2-custom-rpcs: A rename sends no request", async ({
  seededPage: page,
}) => {
  // Only the check asks for health; the connection's own polling does not
  let checks = 0;
  await page.route("https://helius.rpc.test/**", async (route) => {
    if (route.request().postDataJSON()?.method === "getHealth") checks += 1;
    await route.fallback();
  });
  const settings = await openSettings(page);
  await addRpc(page, { name: "Helius", url: "https://helius.rpc.test/" });
  await expect(
    network(page).getByRole("radio", { name: "Helius" })
  ).toBeVisible();
  expect(checks).toBe(1);

  await settings.getByRole("button", { name: "Edit Helius" }).click();
  const form = settings.getByRole("form", { name: "Edit Helius" });
  await form.getByLabel("Name").fill("Triton");
  await form.getByLabel("Name").press("Enter");
  await expect(
    network(page).getByRole("radio", { name: "Triton" })
  ).toBeVisible();
  expect(checks).toBe(1);
});
