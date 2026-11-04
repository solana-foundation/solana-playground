import { Keypair } from "@solana/web3.js";

import {
  expect,
  LONG,
  runInTerminal,
  seedLocalWallet,
  seedWorkspace,
  test,
} from "./fixtures";

/**
 * The built-in wallet signs through its signer provider
 * (`utils/wallet/signer-provider.ts`); the default, local one still hands
 * project code `pg.wallet.keypair`, as the hello-solana tutorial and the
 * native template's test use it.
 */

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
  "tx.sign(pg.wallet.keypair);",
  'console.log("signed by", tx.signatures[0].publicKey.toBase58(), tx.verifySignatures());',
  "",
].join("\n");

test("wallet-signing: Project code signs with pg.wallet.keypair", async ({
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

  await page.getByRole("button", { name: "client", exact: true }).click();
  await page.getByRole("button", { name: "client.ts" }).click();
  const lines = page.locator(".monaco-editor .view-lines");
  await expect(lines).toContainText("My address", LONG);
  await page.locator(".monaco-editor textarea.inputarea").focus();
  await page.keyboard.press("ControlOrMeta+A");
  // A paste, not typing: the editor closes brackets as they are typed
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((text) => navigator.clipboard.writeText(text), CLIENT);
  await page.keyboard.press("ControlOrMeta+V");
  await expect(lines).toContainText("tx.sign(pg.wallet.keypair);");

  const drawer = page.getByRole("button", { name: "Terminal", exact: true });
  if ((await drawer.getAttribute("aria-expanded")) !== "true") {
    await drawer.click();
  }
  await runInTerminal(page, "run");
  await expect(page.locator(".xterm-rows").first()).toContainText(
    `signed by ${address} true`,
    LONG
  );
});
