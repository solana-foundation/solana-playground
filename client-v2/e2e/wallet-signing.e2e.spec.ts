import type { Page } from "@playwright/test";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
  deployHelloWorldWith,
  expect,
  greetWithAnchor,
  HELLO_ANCHOR_IDL,
  LONG,
  openTerminal,
  replaceFile,
  runInTerminal,
  seedLocalWallet,
  seedPlaynetProject,
  seedWorkspace,
  terminalRows,
  test,
} from "./fixtures";

/**
 * The built-in wallet signs through its signer provider
 * (`utils/wallet/signer-provider.ts`). Project code runs in the sandbox, whose
 * `pg.wallet.keypair` signs through the page (`sandbox-signer-provider.ts`),
 * as the hello-solana tutorial and the native template's test use it.
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
  // Awaited: the sandbox's keypair signs through the page, and the real
  // signature is in the transaction once the promise resolves
  "await tx.sign(pg.wallet.keypair);",
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
  await replaceFile(context, page)("client", "client.ts")(CLIENT);

  await openTerminal(page);
  await runInTerminal(page, "run");
  await expect(terminalRows(page)).toContainText(
    `signed by ${address} true`,
    LONG
  );
});

/** Funds the wallet, then runs `body` with `to`, a fresh address */
const clientWith = (body: string[]) =>
  [
    "const airdrop = await pg.connection.requestAirdrop(pg.wallet.publicKey, web3.LAMPORTS_PER_SOL);",
    "await pg.connection.confirmTransaction(airdrop);",
    "const to = web3.Keypair.generate().publicKey;",
    "const transfer = web3.SystemProgram.transfer({ fromPubkey: pg.wallet.publicKey, toPubkey: to, lamports: 1000000 });",
    "const { blockhash } = await pg.connection.getLatestBlockhash();",
    body.join("\n"),
  ].join("\n");

/** Prints whether a sent transaction landed without error, and its signer */
const REPORT = [
  "await pg.connection.confirmTransaction(sig);",
  "const { value } = await pg.connection.getSignatureStatuses([sig]);",
  'console.log("landed:", value[0] !== null && value[0].err === null, "received:", await pg.connection.getBalance(to));',
].join("\n");

const runFor = (page: Page) => async (command: string, expected: RegExp) => {
  await runInTerminal(page, command);
  await expect(terminalRows(page)).toContainText(expected, LONG);
};

test.describe("wallet-signing in the sandbox", () => {
  test("wallet-signing: Project code gets the sandbox provider by default", async ({
    context,
    page,
  }) => {
    const { writeClient, address } = await seedPlaynetProject(context, page);
    await writeClient(
      [
        "const kp = pg.wallet.keypair;",
        "let refused = false;",
        "try { kp.secretKey; } catch (e) { refused = true; }",
        'console.log("keypair:", kp instanceof web3.Keypair, kp.publicKey.toBase58(), refused);',
      ].join("\n")
    );

    await runFor(page)("run", new RegExp(`keypair: true ${address} true`));
  });

  test("wallet-signing: pg.wallet signs from the sandbox", async ({
    context,
    page,
  }) => {
    const { writeClient } = await seedPlaynetProject(context, page);
    await writeClient(
      clientWith([
        "const legacy = () => {",
        "  const tx = new web3.Transaction().add(transfer);",
        "  tx.feePayer = pg.wallet.publicKey;",
        "  tx.recentBlockhash = blockhash;",
        "  return tx;",
        "};",
        "const one = await pg.wallet.signTransaction(legacy());",
        "const all = await pg.wallet.signAllTransactions([legacy(), legacy()]);",
        'const signature = await pg.wallet.signMessage(new TextEncoder().encode("hello"));',
        'console.log("signed:", one.verifySignatures(), all.every((tx) => tx.verifySignatures()), signature.length);',
      ])
    );

    await runFor(page)("run", /signed: true true 64/);
  });

  test("wallet-signing: No message to the sandbox carries the key", async ({
    context,
    page,
  }) => {
    // Records every message the page posts on a port, as JSON of its bytes
    await page.addInitScript(() => {
      const log: string[] = [];
      Object.assign(window, { __portLog: log });
      const post = MessagePort.prototype.postMessage;
      MessagePort.prototype.postMessage = function (
        this: MessagePort,
        ...args: Parameters<MessagePort["postMessage"]>
      ) {
        log.push(
          JSON.stringify(args[0], (_key, value) =>
            value instanceof Uint8Array ? Array.from(value) : value
          )
        );
        return post.apply(this, args);
      };
    });
    const { writeClient, keypair } = await seedPlaynetProject(context, page);
    await writeClient(
      clientWith([
        "const legacy = new web3.Transaction().add(transfer);",
        "legacy.feePayer = pg.wallet.publicKey;",
        "legacy.recentBlockhash = blockhash;",
        "await legacy.sign(pg.wallet.keypair);",
        "const v0 = new web3.VersionedTransaction(new web3.TransactionMessage({",
        "  payerKey: pg.wallet.publicKey, recentBlockhash: blockhash, instructions: [transfer],",
        "}).compileToV0Message());",
        "await pg.wallet.signTransaction(v0);",
        'await pg.wallet.signMessage(new TextEncoder().encode("hello"));',
        'console.log("all signed");',
      ])
    );

    await runFor(page)("run", /all signed/);

    const posted = await page.evaluate(
      () => (window as unknown as { __portLog: string[] }).__portLog
    );
    expect(posted.some((message) => message.includes('"signature"'))).toBe(
      true
    );
    const privateKey = Buffer.from(keypair.secretKey.slice(0, 32));
    const forms = [
      privateKey.toString("hex"),
      privateKey.toString("base64"),
      new PublicKey(privateKey).toBase58(),
      Array.from(privateKey).join(","),
    ];
    for (const message of posted) {
      for (const form of forms) expect(message).not.toContain(form);
    }
  });

  test("wallet-signing: The hello-solana client signs with tx.sign", async ({
    context,
    page,
  }) => {
    const { writeClient } = await seedPlaynetProject(context, page);
    // The tutorial's page 3: a synchronous sign, then the raw bytes
    await writeClient(
      clientWith([
        "const tx = new web3.Transaction().add(transfer);",
        "tx.feePayer = pg.wallet.publicKey;",
        "tx.recentBlockhash = blockhash;",
        "tx.sign(pg.wallet.keypair);",
        "const sig = await pg.connection.sendRawTransaction(tx.serialize());",
        REPORT,
        'console.log("signer:", tx.verifySignatures(), tx.signatures[0].publicKey.equals(pg.wallet.publicKey));',
      ])
    );

    await runFor(page)("run", /signer: true true/);
    await expect(terminalRows(page)).toContainText(
      "landed: true received: 1000000"
    );
  });

  test("wallet-signing: sendAndConfirmTransaction with pg.wallet.keypair", async ({
    context,
    page,
  }) => {
    const { writeClient } = await seedPlaynetProject(context, page);
    await writeClient(
      clientWith([
        "const sig = await web3.sendAndConfirmTransaction(pg.connection, new web3.Transaction().add(transfer), [pg.wallet.keypair]);",
        REPORT,
      ])
    );

    await runFor(page)("run", /landed: true received: 1000000/);
  });

  test("wallet-signing: A v0 transaction signed with pg.wallet.keypair", async ({
    context,
    page,
  }) => {
    const { writeClient } = await seedPlaynetProject(context, page);
    await writeClient(
      clientWith([
        "const tx = new web3.VersionedTransaction(new web3.TransactionMessage({",
        "  payerKey: pg.wallet.publicKey, recentBlockhash: blockhash, instructions: [transfer],",
        "}).compileToV0Message());",
        "tx.sign([pg.wallet.keypair]);",
        "const sig = await pg.connection.sendTransaction(tx);",
        REPORT,
      ])
    );

    await runFor(page)("run", /landed: true received: 1000000/);
  });

  test("wallet-signing: Another signer alongside the wallet", async ({
    context,
    page,
  }) => {
    const { writeClient } = await seedPlaynetProject(context, page);
    await writeClient(
      clientWith([
        "const newAccount = web3.Keypair.generate();",
        "const tx = new web3.Transaction().add(transfer, web3.SystemProgram.createAccount({",
        "  fromPubkey: pg.wallet.publicKey, newAccountPubkey: newAccount.publicKey,",
        "  lamports: await pg.connection.getMinimumBalanceForRentExemption(0), space: 0,",
        "  programId: web3.SystemProgram.programId,",
        "}));",
        "tx.feePayer = pg.wallet.publicKey;",
        "tx.recentBlockhash = blockhash;",
        "tx.sign(pg.wallet.keypair, newAccount);",
        "const sig = await pg.connection.sendRawTransaction(tx.serialize());",
        REPORT,
        'console.log("both signed:", tx.verifySignatures(), (await pg.connection.getAccountInfo(newAccount.publicKey)) !== null);',
      ])
    );

    await runFor(page)("run", /both signed: true true/);
    await expect(terminalRows(page)).toContainText(
      "landed: true received: 1000000"
    );
  });

  test("wallet-signing: Reading the secret key", async ({ context, page }) => {
    const { writeClient } = await seedPlaynetProject(context, page);
    await writeClient(
      [
        "try {",
        '  console.log("bytes:", pg.wallet.keypair.secretKey);',
        "} catch (e) {",
        '  console.log("refused:", e.message.includes("pg.wallet.signMessage"), e.message.includes("pg.wallet.signTransaction"));',
        "}",
      ].join("\n")
    );

    await runFor(page)("run", /refused: true true/);
    await expect(terminalRows(page)).not.toContainText("bytes:", {
      timeout: 1,
    });
  });

  test("wallet-signing: Anchor's payer signs an instruction", async ({
    context,
    page,
  }) => {
    test.slow();
    const { writeTest } = await seedPlaynetProject(context, page);
    await deployHelloWorldWith(HELLO_ANCHOR_IDL)(page);
    await writeTest(greetWithAnchor("sendAndConfirm"));

    await runFor(page)("test", /1 passing/);

    await expect(terminalRows(page)).toContainText("greeted: 1");
  });

  test("wallet-signing: The native template's test passes", async ({
    context,
    page,
  }) => {
    test.slow();
    await seedPlaynetProject(context, page);
    await deployHelloWorldWith(undefined)(page);

    // The template's own test, untouched
    await runFor(page)("test", /1 passing/);
  });
});
