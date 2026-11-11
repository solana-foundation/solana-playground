import type { Frame, Page } from "@playwright/test";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
  expect,
  LONG,
  openTerminal,
  replaceFile,
  runInTerminal,
  seedLocalWalletFor,
  seedWorkspace,
  terminalRows,
  test,
} from "./fixtures";

/**
 * The built-in wallet with its keys on a key origin of their own
 * (`utils/wallet/key-origin`): the app on `localhost` keeps its keys in a
 * hidden key page on `127.0.0.1`, the same port (`loopback`).
 *
 * The setting is compiled into the bundle, so this spec runs on the config's
 * server only when the shell turns the key origin on, and then it is the only
 * spec that runs (`playwright.config.mts`, `testMatch`); every other run leaves
 * it out (`testIgnore`), with no skip to report. CI runs it in the
 * `e2e-key-origin` job; locally, `yarn test-e2e:key-origin`. Its tests run
 * serially, so they share one worker.
 */

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

/**
 * `seedWorkspace`, then wait for the seeded keys to leave the page: the key
 * page has `KEY_PAGE_LOAD_TIMEOUT_MS` to load even while the app's own first
 * load is slow (16 s on the CI runner), so no retry is taken here.
 */
const seedWorkspaceWithKeysMoved = async (page: Page) => {
  await seedWorkspace(page);
  await expect
    .poll(
      async () =>
        (
          await storedWallet(page)
        )?.accounts.every(
          ({ kp, publicKey }) => kp === undefined && publicKey !== undefined
        ),
      LONG
    )
    .toBe(true);
};

test("wallet-storage: Three accounts move", async ({ page }) => {
  const { addresses, names, wallet } = threeAccounts();
  await seedLocalWalletFor(page)(wallet);

  await seedWorkspaceWithKeysMoved(page);

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
  await seedLocalWalletFor(page)({
    state: "pg",
    accounts: [{ kp: Array.from(keypair.secretKey), name: "Wallet 1" }],
    currentIndex: 0,
  });

  // Signed only once the key has left the page
  await seedWorkspaceWithKeysMoved(page);
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
  await seedLocalWalletFor(page)({ state: "pg", accounts, currentIndex: 0 });

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

/**
 * One account seeded the old way, then loaded: resolves once its key has
 * left the page and the wallet is connected
 */
const oneMovedAccount = async (page: Page) => {
  const keypair = Keypair.generate();
  const address = keypair.publicKey.toBase58();
  await seedLocalWalletFor(page)({
    state: "pg",
    accounts: [{ kp: Array.from(keypair.secretKey), name: "Wallet 1" }],
    currentIndex: 0,
  });
  await seedWorkspaceWithKeysMoved(page);
  await expect
    .poll(async () => (await storedWallet(page))?.accounts[0]?.publicKey, LONG)
    .toBe(address);
  await expect(walletStep(page)).toContainText(address.slice(0, 4), LONG);
  return { address, keypair };
};

/**
 * Opens a dialog from the wallet panel's Settings menu. Its trigger is the one
 * "More" with a `title`; the assistant's and the project row's are labelled
 */
const openFromSettings = async (page: Page, item: "Export" | "Import") => {
  await page.locator('button[title="More"]').click();
  await page.getByRole("menuitem", { name: item }).click();
};

test("wallet-signing: Export from Settings", async ({ page }) => {
  const { address } = await oneMovedAccount(page);
  await openWalletPanel(page, address);

  await openFromSettings(page, "Export");
  const dialog = page.getByRole("dialog", { name: "Export keypair" });
  await expect(dialog).toBeVisible();
  const save = page
    .frameLocator('iframe[title="Save keypair"]')
    .getByRole("button", { name: "Save keypair" });
  await expect(save).toBeEnabled(LONG);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    save.click(),
  ]);
  expect(download.suggestedFilename()).toBe("Wallet 1-keypair.json");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes: unknown = JSON.parse(Buffer.concat(chunks).toString());
  expect(Array.isArray(bytes) && bytes.length).toBe(64);
  expect(
    Keypair.fromSecretKey(Uint8Array.from(bytes as number[])).publicKey
  ).toEqual(new PublicKey(address));

  // Escape with the focus inside the panel closes the dialog, as it does
  // from the dialog's own document
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await openFromSettings(page, "Export");
  await expect(save).toBeEnabled(LONG);
  const focusedInPanel = () =>
    save.evaluate(
      (button) => document.hasFocus() && document.activeElement === button
    );
  for (let i = 0; i < 10 && !(await focusedInPanel()); i++) {
    await page.keyboard.press("Tab");
  }
  expect(await focusedInPanel()).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("wallet-signing: Import a key file", async ({ page }) => {
  const { address } = await oneMovedAccount(page);
  await openWalletPanel(page, address);

  const imported = Keypair.generate();
  const importedAddress = imported.publicKey.toBase58();
  await openFromSettings(page, "Import");
  const dialog = page.getByRole("dialog", { name: "Import keypair" });
  await expect(dialog).toBeVisible();
  const panel = page.frameLocator('iframe[title="Import keypair"]');
  await expect(
    panel.getByRole("button", { name: "Import keypair" })
  ).toBeEnabled(LONG);
  await panel.locator('input[type="file"]').setInputFiles({
    name: "imported-keypair.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(Array.from(imported.secretKey))),
  });
  await expect(dialog).toContainText(
    `Imported ${importedAddress.slice(0, 4)}`,
    LONG
  );
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();

  // The account menu lists it
  await page.getByText(/^Wallet \d+ - \(/).click();
  await expect(
    page.getByRole("menuitem", {
      name: `Wallet 2 - (${importedAddress.slice(
        0,
        3
      )}...${importedAddress.slice(-3)})`,
    })
  ).toBeVisible();

  // The page's record has the account, and the key file's bytes stayed on
  // the key page
  await expect
    .poll(
      async () =>
        (await storedWallet(page))?.accounts.map(({ publicKey }) => publicKey),
      LONG
    )
    .toEqual([address, importedAddress]);
  expect(JSON.stringify(await storedWallet(page))).not.toMatch(
    SECRET_KEY_ARRAY
  );
  for (const value of await localValues(page)) {
    expect(value).not.toMatch(SECRET_KEY_ARRAY);
  }
  const frame = keyFrame(page);
  expect((await heldKeys(frame as Frame)).sort()).toEqual(
    [address, importedAddress].sort()
  );
});
