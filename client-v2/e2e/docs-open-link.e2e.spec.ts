import type { Page } from "@playwright/test";
import { deflateRaw } from "pako";

import { DEVNET_WS, expect, json, LONG, test } from "./fixtures";

/**
 * Builds a docs link as the docs site does. Written here rather than
 * imported: `features/docs-link/lib/link.ts` carries an in-source test block,
 * which Playwright's CommonJS compile cannot load.
 */
const docsLink = (link: {
  name: string;
  code: string;
  title?: string;
  from?: string;
  sol?: number;
}) => {
  const params = new URLSearchParams({ v: "1", name: link.name });
  if (link.title) params.set("title", link.title);
  if (link.from) params.set("from", link.from);
  if (link.sol) params.set("sol", String(link.sol));
  params.set(
    "code",
    Buffer.from(deflateRaw(Buffer.from(link.code, "utf8"))).toString(
      "base64url"
    )
  );
  return `/open#${params.toString()}`;
};

const DOCS_PAGE = "https://solana.com/docs/quickstart";

/** The Quickstart's client, built with no RPC call, then its signer and a Map */
const QUICKSTART = [
  'import { createClient } from "@solana/kit";',
  'import { solanaDevnetRpc } from "@solana/kit-plugin-rpc";',
  'import { signerFromFile } from "@solana/kit-plugin-signer";',
  'import { systemProgram } from "@solana-program/system";',
  'import { token2022Program } from "@solana-program/token-2022";',
  "const client = await createClient()",
  '  .use(signerFromFile("wallet.json"))',
  "  .use(solanaDevnetRpc())",
  "  .use(systemProgram())",
  "  .use(token2022Program());",
  'console.log("same wallet:", client.identity.address === pg.wallet.publicKey.toBase58());',
  'for (const [k] of new Map([["a", 1]])) console.log("map:", k);',
  "console.log(1_000n * 2n);",
].join("\n");

/** The cluster answers `getBalance` with `lamports`; anything else goes on */
const stubBalance = (lamports: () => number, page: Page) =>
  page.route("https://api.devnet.solana.com/**", async (route) => {
    const body = route.request().postDataJSON() as {
      id?: unknown;
      method?: string;
    } | null;
    if (body?.method !== "getBalance") return route.continue();
    return json(route, {
      jsonrpc: "2.0",
      id: body.id,
      result: { context: { slot: 1 }, value: lamports() },
    });
  });

/** What the stubbed devnet answers, by JSON-RPC method */
const DEVNET_ANSWERS: Record<string, unknown> = {
  getBalance: { context: { slot: 1 }, value: 1_000_000_000 },
  getLatestBlockhash: {
    context: { slot: 1 },
    value: {
      blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
      lastValidBlockHeight: 1000,
    },
  },
  getGenesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  getSlot: 1,
  getVersion: { "solana-core": "2.2.0", "feature-set": 0 },
};

/**
 * Answers every devnet request here, so a client that reads the cluster
 * never waits on the public RPC (HOO-2585): an answer from the table, else a
 * JSON-RPC "method not found". The websocket is accepted and stays silent.
 */
const stubDevnet = async (page: Page) => {
  await page.route("https://api.devnet.solana.com/**", async (route) => {
    const body = route.request().postDataJSON() as {
      id?: unknown;
      method?: string;
    } | null;
    const method = body?.method ?? "";
    if (method in DEVNET_ANSWERS) {
      return json(route, {
        jsonrpc: "2.0",
        id: body?.id,
        result: DEVNET_ANSWERS[method],
      });
    }
    return json(route, {
      jsonrpc: "2.0",
      id: body?.id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  });
  await page.routeWebSocket(DEVNET_WS, () => {});
};

/**
 * Presses Run. A fresh browser has no Playground wallet yet, so Run first
 * opens its setup, which the test completes.
 */
const run = async (page: Page) => {
  await page.locator("#flow-run").click();
  await page.getByRole("button", { name: "Continue" }).click(LONG);
};

const callout = (page: Page) => page.locator("#client-run-callout");

test.describe("docs-open-link", () => {
  test("docs-open-link: The Quickstart link", async ({ page }) => {
    await page.goto(
      docsLink({
        name: "quickstart.ts",
        code: QUICKSTART,
        title: "Quickstart",
        from: DOCS_PAGE,
        sol: 0.02,
      })
    );

    await expect(page.getByText("quickstart.ts").first()).toBeVisible(LONG);
    await expect(page.locator("#flow-client-project")).toBeVisible();
    await expect(page.locator("#flow-run")).toHaveText("Run");
    await expect(page.locator("#flow-stage-tab-build")).toHaveCount(0);
    await expect(callout(page)).toHaveAttribute("data-state", "source");
    await expect(callout(page)).toContainText("From solana.com: Quickstart");
    await expect(
      callout(page).getByRole("link", { name: "View the docs page" })
    ).toHaveAttribute("href", DOCS_PAGE);
  });

  test("docs-open-link: No title", async ({ page }) => {
    await page.goto(docsLink({ name: "hello.ts", code: "console.log(1)" }));
    await expect(callout(page)).toContainText("From a docs link: hello", LONG);
  });

  test("docs-open-link: A truncated link", async ({ page }) => {
    const link = docsLink({
      name: "quickstart.ts",
      code: QUICKSTART,
      from: DOCS_PAGE,
    });
    await page.goto(link.slice(0, -40));

    const broken = page.locator("#docs-link-broken");
    await expect(broken).toContainText("This link is broken", LONG);
    await expect(page.locator("#docs-link-back")).toHaveAttribute(
      "href",
      DOCS_PAGE
    );
    await expect(page.locator("#flow-run")).toHaveCount(0);
  });

  test("docs-open-link: A link with no source and no referrer", async ({
    page,
  }) => {
    await page.goto("/open#v=1&name=a.ts");
    await expect(page.locator("#docs-link-back")).toHaveAttribute(
      "href",
      "https://solana.com/docs",
      LONG
    );
    await page.locator("#docs-link-home").click();
    await expect(page).toHaveURL(/\/home$/);
  });
});

test.describe("client-run", () => {
  test("client-run: One press", async ({ page }) => {
    await page.goto(docsLink({ name: "hello.ts", code: 'console.log("hi")' }));
    await run(page);

    await expect(page.locator("#flow-run")).toHaveText("Run again", LONG);
    await expect(callout(page)).toHaveAttribute("data-state", "done");
    await expect(callout(page)).toContainText(/Ran in \d+ s/);
    await expect(page.locator(".xterm-rows")).toContainText("Running client");
  });

  test("client-run: The Quickstart's client", async ({ page }) => {
    await stubDevnet(page);
    await page.goto(docsLink({ name: "quickstart.ts", code: QUICKSTART }));
    await run(page);

    await expect(callout(page)).toHaveAttribute("data-state", "done", LONG);
    const terminal = page.locator(".xterm-rows");
    await expect(terminal).toContainText("same wallet: true");
    await expect(terminal).toContainText("2000n");
  });

  test("client-run: Iterating a Map", async ({ page }) => {
    await stubDevnet(page);
    await page.goto(docsLink({ name: "quickstart.ts", code: QUICKSTART }));
    await run(page);
    await expect(page.locator(".xterm-rows")).toContainText("map: a", LONG);
  });

  test("client-run: A failure midway", async ({ page }) => {
    await page.goto(
      docsLink({
        name: "steps.ts",
        code: [
          'console.log("Step 1");',
          'console.log("Step 2");',
          'throw new Error("fetch failed");',
        ].join("\n"),
      })
    );
    await run(page);

    await expect(callout(page)).toHaveAttribute("data-state", "failed", LONG);
    await expect(callout(page)).toContainText("fetch failed");
    await expect(page.locator(".xterm-rows")).toContainText("Step 2");
    await expect(page.locator(".xterm-rows")).toContainText(
      "Uncaught error: fetch failed"
    );
  });

  test("client-run: An error the script does not await", async ({ page }) => {
    await page.goto(
      docsLink({
        name: "late.ts",
        code: ['Promise.reject(new Error("boom"));', "await sleep(300);"].join(
          "\n"
        ),
      })
    );
    await run(page);

    await expect(callout(page)).toHaveAttribute("data-state", "failed", LONG);
    await expect(callout(page)).toContainText("boom");
  });

  test("client-run: An import Playground cannot load", async ({ page }) => {
    await page.goto(
      docsLink({
        name: "memo.ts",
        code: [
          'import { getAddMemoInstruction } from "@solana-program/memo";',
          'console.log("ran");',
        ].join("\n"),
      })
    );
    await run(page);

    await expect(callout(page)).toHaveAttribute(
      "data-state",
      "missing-package",
      LONG
    );
    await expect(callout(page)).toContainText("@solana-program/memo");
    await expect(page.locator(".xterm-rows")).not.toContainText("ran");
  });

  test("client-run: A new wallet", async ({ page }) => {
    await stubBalance(() => 0, page);
    await page.goto(
      docsLink({ name: "quickstart.ts", code: QUICKSTART, sol: 0.02 })
    );
    await run(page);

    const card = page.locator("#client-run-funding");
    await expect(card).toContainText("0 SOL", LONG);
    await expect(card).toContainText("0.02 SOL");
    await expect(
      card.getByRole("link", { name: "Get devnet SOL" })
    ).toHaveAttribute(
      "href",
      /^https:\/\/faucet\.solana\.com\/\?walletAddress=[1-9A-HJ-NP-Za-km-z]{32,44}&cluster=devnet$/
    );
    await expect(page.locator(".xterm-rows")).not.toContainText("same wallet");
  });

  test("client-run: Funded while the card shows", async ({ page }) => {
    let lamports = 0;
    await stubBalance(() => lamports, page);
    await page.goto(
      docsLink({ name: "quickstart.ts", code: QUICKSTART, sol: 0.02 })
    );
    await run(page);
    await expect(page.locator("#client-run-funding")).toBeVisible(LONG);

    lamports = 500_000_000;
    await page.getByRole("button", { name: "Check again" }).click();

    await expect(page.locator("#client-run-funding")).toHaveCount(0);
    await expect(callout(page)).toHaveAttribute("data-state", "done", LONG);
  });
});
