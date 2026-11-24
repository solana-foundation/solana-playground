import type { BrowserContext, Page } from "@playwright/test";
import { address, lamports } from "@solana/kit";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs";
import path from "path";

import { clusterOf } from "../src/commands/anchor/__fixtures__/cluster";
import {
  expect,
  json,
  LONG,
  openTerminal,
  replaceFile,
  runInTerminal,
  seedLocalWalletFor,
  seedNativeWorkspace,
  terminalRows,
} from "./fixtures";
import { type Cluster, LOCALNET, serveFor } from "./program-idl";

// A Native project whose code runs in the sandbox against Localnet, which LiteSVM answers in Playwright's process, shared by the `project-code-sandbox` and `wallet-signing` specs

/**
 * A program that logs and succeeds, and changes no account: the hello world
 * test program of the removed in-browser cluster, kept as its ELF. It stands
 * in for a built program so a test can send instructions to a deployed
 * program offline; it is not the Native template's program, which counts
 * greetings.
 */
const HELLO_WORLD_SO = path.join(__dirname, "hello-world.so");

/** What the wallet holds before the page loads: enough for a deploy */
const WALLET_FUNDS = lamports(BigInt(10 * LAMPORTS_PER_SOL));

/**
 * Selects Localnet on every load, after the fixture's Devnet default, so
 * the page and the sandbox reach the cluster {@link serveFor} answers
 */
const startOnLocalnet = (page: Page) =>
  page.addInitScript((endpoint) => {
    localStorage.setItem(
      "settings",
      JSON.stringify({ connection: { endpoint } })
    );
  }, LOCALNET.endpoint);

/**
 * Builds and deploys the hello world program to `cluster` from the terminal,
 * with the build server answered here: CI has none. The build hands the
 * project its program id and, when given, an IDL; the deploy writes the
 * program through the upgradeable loader, which LiteSVM runs.
 *
 * @param idl the IDL the build answers with
 */
export const deployHelloWorldWith =
  (idl: object | undefined) => async (page: Page) => {
    const uuid = "e2e-hello-world";
    await page.route("**/build", (route) =>
      json(route, {
        // `improveOutput` says "Build successful." on this line of cargo's
        stderr: "    Finished release [optimized] target(s) in 1.00s\n",
        uuid,
        // eslint-disable-next-line unicorn/no-null -- the build server's wire shape
        idl: idl ?? null,
      })
    );
    await page.route(`**/deploy/${uuid}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: fs.readFileSync(HELLO_WORLD_SO),
      })
    );
    const rows = terminalRows(page);
    await runInTerminal(page, "build");
    await expect(rows).toContainText("Build successful.", LONG);
    await runInTerminal(page, "deploy");
    await expect(rows).toContainText("Deployment successful.", LONG);
  };

/**
 * A funded built-in wallet and a Native project on Localnet, served by a
 * fresh LiteSVM cluster, with the terminal open; returns the wallet's
 * keypair, the cluster, the RPC methods it left unanswered, and writers
 * for the client and the test
 */
export const seedSandboxProject = async (
  context: BrowserContext,
  page: Page
) => {
  const keypair = Keypair.generate();
  const cluster: Cluster = clusterOf();
  cluster.svm.airdrop(address(keypair.publicKey.toBase58()), WALLET_FUNDS);
  const unanswered = await serveFor(LOCALNET)(cluster)(page);
  await seedLocalWalletFor(page)({
    state: "pg",
    accounts: [{ kp: Array.from(keypair.secretKey), name: "Wallet 1" }],
    currentIndex: 0,
  });
  await startOnLocalnet(page);
  await seedNativeWorkspace(page);
  await openTerminal(page);
  return {
    keypair,
    address: keypair.publicKey.toBase58(),
    cluster,
    unanswered,
    writeClient: (code: string) =>
      replaceFile(context)(page)("client")("client.ts")(code),
    writeTest: (code: string) =>
      replaceFile(context)(page)("tests")("native.test.ts")(code),
  };
};

/**
 * An Anchor IDL for the hello world program, which ignores the instruction
 * data; the greeting account it names is created in the same transaction
 */
export const HELLO_ANCHOR_IDL = {
  version: "0.1.0",
  name: "hello_anchor",
  instructions: [
    {
      name: "greet",
      accounts: [
        { name: "greeting", isMut: true, isSigner: false },
        { name: "payer", isMut: true, isSigner: true },
      ],
      args: [],
    },
  ],
};

/**
 * Test code that creates a greeting account owned by the program in the
 * same transaction as Anchor's `greet`, with `payer` among the signers
 */
export const greetWithAnchor = (sign: "signers" | "sendAndConfirm") =>
  [
    'describe("Anchor", () => {',
    '  it("greets", async () => {',
    "    anchor.setProvider(anchor.AnchorProvider.env());",
    "    const program = anchor.workspace.HelloAnchor;",
    "    const payer = anchor.getProvider().wallet.payer;",
    "    const greeting = web3.Keypair.generate();",
    "    const lamports = await pg.connection.getMinimumBalanceForRentExemption(4);",
    "    const create = web3.SystemProgram.createAccount({",
    "      fromPubkey: payer.publicKey, newAccountPubkey: greeting.publicKey,",
    "      lamports, space: 4, programId: pg.PROGRAM_ID,",
    "    });",
    "    const greet = program.methods.greet()",
    "      .accounts({ greeting: greeting.publicKey, payer: payer.publicKey })",
    "      .preInstructions([create]);",
    sign === "signers"
      ? "    await greet.signers([greeting, payer]).rpc();"
      : "    await web3.sendAndConfirmTransaction(pg.connection, await greet.transaction(), [payer, greeting]);",
    "    const info = await pg.connection.getAccountInfo(greeting.publicKey);",
    '    console.log("same program:", program.programId.equals(pg.PROGRAM_ID), pg.program.programId.equals(pg.PROGRAM_ID));',
    '    console.log("landed:", info.owner.equals(pg.PROGRAM_ID));',
    "  });",
    "});",
  ].join("\n");
