import { type ChildProcess, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import type { Frame, Page } from "@playwright/test";
import { Keypair } from "@solana/web3.js";

import {
  expect,
  LONG,
  openTerminal,
  replaceFile,
  runInTerminal,
  seedLocalWallet,
  seedWorkspace,
  terminalRows,
  test as base,
} from "./fixtures";

/**
 * The built-in wallet with its keys on a key origin of their own
 * (`utils/wallet/key-origin`): the app on `localhost` keeps its keys in a
 * hidden key page on `127.0.0.1`, the same port (`loopback`).
 *
 * The setting is compiled into the bundle, and every other spec runs on the
 * config's server with it off. So this spec starts a dev server of its own
 * with both settings on, once per worker; its tests run serially, so they stay
 * in one worker and, in CI, in one shard, and the server compiles once.
 */

/** What the config seeds for every origin: the file tree open */
const TREE_OPEN_LAYOUT = JSON.stringify({
  v: 2,
  open: { nav: true, files: true, assistant: true, console: false },
});

/** A first compile on a CI runner takes minutes; a hang still fails */
const SERVER_START_MS = 10 * 60_000;

/** A port no one is listening on, from the system */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });

/** Stops the server and everything it started (its own process group) */
const stop = (child: ChildProcess) => {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // Already gone
  }
};

/**
 * `craco start`, not `yarn dev`: the config's server has already run the
 * generate steps in this checkout, and running them again would rewrite the
 * files that server is compiling from.
 */
const startServer = async () => {
  const port = await freePort();
  const output: string[] = [];
  const child = spawn(
    path.join(__dirname, "../node_modules/.bin/craco"),
    ["start"],
    {
      cwd: path.join(__dirname, ".."),
      detached: true,
      env: {
        // eslint-disable-next-line layers/no-test-spread -- the server needs the runner's whole environment (PATH, NODE_OPTIONS, CI), which no list could name
        ...process.env,
        BROWSER: "none",
        PORT: String(port),
        REACT_APP_WALLET_KEY_ORIGIN: "loopback",
        REACT_APP_WALLET_APP_ORIGIN: "loopback",
        // As the config's server: the specs stub the public endpoints
        REACT_APP_DEVNET_RPC_URL: "",
        REACT_APP_MAINNET_RPC_URL: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const keep = (chunk: Buffer) => {
    output.push(chunk.toString());
    if (output.length > 200) output.shift();
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);

  // The dev server holds every request until the first compile is done, so
  // the key page answering means the app's bundle is ready too
  const deadline = Date.now() + SERVER_START_MS;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(
        `The key-origin dev server exited early:\n${output.join("")}`
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/wallet-keys.html`);
      if (response.ok) break;
    } catch {
      // Not listening yet
    }
    if (Date.now() > deadline) {
      stop(child);
      throw new Error(
        `The key-origin dev server did not start in ${SERVER_START_MS} ms:\n${output.join(
          ""
        )}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { child, origin: `http://localhost:${port}` };
};

const test = base.extend<object, { keyOriginApp: string }>({
  keyOriginApp: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from its destructured first argument, and this one has none
    async ({}, use) => {
      const { child, origin } = await startServer();
      try {
        await use(origin);
      } finally {
        stop(child);
      }
    },
    { scope: "worker", timeout: SERVER_START_MS + 60_000 },
  ],
  baseURL: async ({ keyOriginApp }, use) => use(keyOriginApp),
  storageState: async ({ keyOriginApp }, use) =>
    use({
      cookies: [],
      origins: [
        {
          origin: keyOriginApp,
          localStorage: [{ name: "layout", value: TREE_OPEN_LAYOUT }],
        },
      ],
    }),
});

test.describe.configure({ mode: "serial" });

/**
 * The wallet record in the app origin's IndexedDB database. Opening a
 * database that is not there would create it empty, which the wallet then
 * reads as a damaged store, so a missing one is left alone.
 */
const storedWallet = (page: Page) =>
  page.evaluate(async () =>
    (await indexedDB.databases()).some((db) => db.name === "pg-wallet")
      ? new Promise<
          | {
              accounts: Array<{
                kp?: number[];
                name: string;
                publicKey?: string;
              }>;
              currentIndex: number;
            }
          | undefined
        >((resolve, reject) => {
          const open = indexedDB.open("pg-wallet");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains("wallet-state")) {
              return resolve(undefined);
            }
            const get = db
              .transaction("wallet-state", "readonly")
              .objectStore("wallet-state")
              .get("wallet");
            get.onerror = () => reject(get.error);
            get.onsuccess = () => resolve(get.result);
          };
        })
      : undefined
  );

/** Every `localStorage` value of the app origin */
const localValues = (page: Page) =>
  page.evaluate(() =>
    Array.from(
      { length: localStorage.length },
      (_, i) => localStorage.getItem(localStorage.key(i) ?? "") ?? ""
    )
  );

/** A JSON array of 64 numbers: a secret key as the wallet serializes it */
const SECRET_KEY_ARRAY = /\[\s*(\d+\s*,\s*){63}\d+\s*\]/;

/** The hidden key page, framed by the app */
const keyFrame = (page: Page) =>
  page.frames().find((frame) => frame.url().includes("/wallet-keys.html"));

/** The public keys the key page's own database holds */
const heldKeys = (frame: Frame) =>
  frame.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("pg-wallet-keys");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("keys")) return resolve([]);
          const all = db
            .transaction("keys", "readonly")
            .objectStore("keys")
            .getAllKeys();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => resolve(all.result.map(String));
        };
      })
  );

/** Three accounts, the second current, as an earlier version left them */
const threeAccounts = () => {
  const keypairs = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  const names = ["Alpha", "Beta", "Gamma"];
  return {
    addresses: keypairs.map((keypair) => keypair.publicKey.toBase58()),
    names,
    wallet: {
      state: "pg",
      accounts: keypairs.map((keypair, i) => ({
        kp: Array.from(keypair.secretKey),
        name: names[i],
      })),
      currentIndex: 1,
    },
  };
};

const walletStep = (page: Page) =>
  page
    .locator('[data-slot="setup-list-item"][data-status="done"]')
    .filter({ hasText: "Connect a wallet" });

/** The wallet panel, opened from the account menu's wallet row */
const openWalletPanel = async (page: Page, address: string) => {
  await page
    .locator('[data-slot="sidebar"] [data-slot="sidebar-footer"]')
    .getByRole("button", { name: /^Account/ })
    .click();
  await page
    .getByRole("menu", { name: "Account" })
    .getByRole("menuitem")
    .filter({ hasText: address.slice(0, 4) })
    .click();
};

test("wallet-storage: Three accounts move", async ({ page }) => {
  const { addresses, names, wallet } = threeAccounts();
  await seedLocalWallet(page)(wallet);

  await seedWorkspace(page);

  // The page's record keeps the names and public keys, and no key bytes
  await expect
    .poll(
      async () =>
        (
          await storedWallet(page)
        )?.accounts.map(({ name, publicKey, kp }) => ({
          name,
          publicKey,
          kp,
        })),
      LONG
    )
    .toEqual(
      names.map((name, i) => ({
        name,
        publicKey: addresses[i],
        kp: undefined,
      }))
    );
  expect((await storedWallet(page))?.currentIndex).toBe(1);
  expect(JSON.stringify(await storedWallet(page))).not.toMatch(
    SECRET_KEY_ARRAY
  );
  for (const value of await localValues(page)) {
    expect(value).not.toMatch(SECRET_KEY_ARRAY);
  }

  // The key page holds the three keys
  await expect.poll(() => keyFrame(page)?.url(), LONG).toBeDefined();
  const frame = keyFrame(page);
  expect(new URL(frame?.url() ?? "").hostname).toBe("127.0.0.1");
  expect((await heldKeys(frame as Frame)).sort()).toEqual(
    Array.from(addresses).sort()
  );

  // The current account is still the second, and the menu lists all three
  await expect(walletStep(page)).toContainText(addresses[1].slice(0, 4), LONG);
  await openWalletPanel(page, addresses[1]);
  await page.getByText(new RegExp(`^${names[1]} - \\(`)).click();
  for (const name of names) {
    await expect(
      page.getByRole("menuitem", { name: new RegExp(`^${name} - `) })
    ).toBeVisible();
  }
});

/** Signs a transfer with `pg.wallet.keypair`, offline, and prints the result */
const CLIENT = [
  "const tx = new web3.Transaction({",
  "  feePayer: pg.wallet.publicKey,",
  '  recentBlockhash: "11111111111111111111111111111111",',
  "}).add(",
  "  web3.SystemProgram.transfer({",
  "    fromPubkey: pg.wallet.publicKey,",
  "    toPubkey: pg.wallet.publicKey,",
  "    lamports: 1,",
  "  })",
  ");",
  "await tx.sign(pg.wallet.keypair);",
  'console.log("signed by", tx.signatures[0].publicKey.toBase58(), tx.verifySignatures());',
  "",
].join("\n");

test("wallet-signing: Project code signs through the page and the key page", async ({
  context,
  page,
}) => {
  const keypair = Keypair.generate();
  const address = keypair.publicKey.toBase58();
  await seedLocalWallet(page)({
    state: "pg",
    accounts: [{ kp: Array.from(keypair.secretKey), name: "Wallet 1" }],
    currentIndex: 0,
  });

  await seedWorkspace(page);
  // Signed only once the key has left the page
  await expect
    .poll(async () => (await storedWallet(page))?.accounts[0]?.kp, LONG)
    .toBeUndefined();
  await expect
    .poll(async () => (await storedWallet(page))?.accounts[0]?.publicKey, LONG)
    .toBe(address);

  await replaceFile(context)(page)("client")("client.ts")(CLIENT);
  await openTerminal(page);
  await runInTerminal(page, "run");

  await expect(terminalRows(page)).toContainText(
    `signed by ${address} true`,
    LONG
  );
});

test("wallet-storage: The key origin is blocked", async ({ page }) => {
  const keypair = Keypair.generate();
  const address = keypair.publicKey.toBase58();
  const accounts = [{ kp: Array.from(keypair.secretKey), name: "Wallet 1" }];
  await page.route("http://127.0.0.1:*/**", (route) => route.abort());
  await seedLocalWallet(page)({ state: "pg", accounts, currentIndex: 0 });

  await seedWorkspace(page);

  const unavailable = page.getByRole("button", {
    name: "Wallet unavailable, try again",
  });
  await expect(unavailable).toBeVisible(LONG);

  // The key stays where the page kept it: in its own store, or still in
  // `localStorage` if the wallet never got that far
  const kept = async () =>
    (await storedWallet(page))?.accounts ??
    JSON.parse(
      (await page.evaluate(() => localStorage.getItem("wallet"))) ?? "{}"
    ).accounts;
  expect(
    ((await kept()) as Array<{ kp?: number[]; name: string }>).map(
      ({ kp, name }) => ({ kp, name })
    )
  ).toEqual(accounts);

  // Try again asks the key page again, and with it back the key moves
  await page.unroute("http://127.0.0.1:*/**");
  await unavailable.click();
  await expect(walletStep(page)).toContainText(address.slice(0, 4), LONG);
  await expect
    .poll(async () => (await storedWallet(page))?.accounts[0]?.kp, LONG)
    .toBeUndefined();
});
