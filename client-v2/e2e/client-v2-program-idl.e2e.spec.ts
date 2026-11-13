import type { Page } from "@playwright/test";
import { address, lamports } from "@solana/kit";
import { Keypair } from "@solana/web3.js";
import {
  AccountDiscriminator,
  findCanonicalPda,
} from "@solana-program/program-metadata";

import { clusterOf } from "../src/commands/anchor/__fixtures__/cluster";
import { expect, LONG, runInTerminal, test } from "./fixtures";
import {
  BASE58,
  type Cluster,
  connectedWallet,
  CUSTOM_RPC,
  idlText,
  incompressible,
  openTerminal,
  PROGRAM,
  runUntil,
  selectNetworkAndWallet,
  serveOn,
  terminalOf,
  writeFileWith,
} from "./program-idl";
import { lineOf, linesOn } from "./telemetry";

// The browser path of `anchor idl` on a custom RPC that LiteSVM answers in Playwright's process; what each subcommand computes is `anchor.integration.test.ts`'s

const serveFrom = serveOn(CUSTOM_RPC);

/** Selects {@link CUSTOM_RPC} and a Playground wallet that holds `wallet`, then reloads onto both */
const selectRpcAndWallet = (wallet: Keypair) => (page: Page) =>
  selectNetworkAndWallet(CUSTOM_RPC)(page, connectedWallet(wallet));

test.describe("client-v2-program-idl", () => {
  let cluster: Cluster;
  let metadata: string;
  // Set before any hook runs, so a setup that fails before `serveFrom` reports its own error here
  let unanswered = new Set<string>();

  test.beforeEach(async ({ seededPage: page }) => {
    cluster = clusterOf();
    const wallet = Keypair.generate();
    cluster.svm.airdrop(
      address(wallet.publicKey.toBase58()),
      lamports(10_000_000_000n)
    );
    await cluster.deploy(PROGRAM, wallet.publicKey.toBase58());
    [metadata] = await findCanonicalPda({ program: PROGRAM, seed: "idl" });
    unanswered = await serveFrom(cluster)(page);
    await selectRpcAndWallet(wallet)(page);
    await openTerminal(page);
  });

  // A method nobody answered is a request the browser path makes and this file does not serve
  test.afterEach(() => {
    const seen = Array.from(unanswered);
    unanswered = new Set();
    expect(seen).toEqual([]);
  });

  test("client-v2-program-idl: An IDL file", async ({ seededPage: page }) => {
    const text = idlText("0.1.0", []);
    const path = await writeFileWith(text)(page, "counter.json");

    await runUntil(`IDL initialized. Program Metadata account: ${metadata}`)(
      page,
      `anchor idl init --filepath ${path}`
    );

    await runUntil(text)(page, `anchor idl fetch ${PROGRAM}`);
  });

  test("client-v2-program-idl: An upload through a custom RPC is tracked", async ({
    seededPage: page,
  }) => {
    const lines = linesOn(page);
    const path = await writeFileWith(idlText("0.1.0", []))(
      page,
      "counter.json"
    );

    await runUntil("IDL initialized.")(
      page,
      `anchor idl init --filepath ${path}`
    );

    await expect
      .poll(() => lineOf(lines, "idl_uploaded"), LONG)
      .toContain("{target: metadata, cluster: custom}");
    expect(lineOf(lines, "idl_upload_started")).toContain(
      "{target: metadata, cluster: custom}"
    );
  });

  test("client-v2-program-idl: A second upload replaces the first", async ({
    seededPage: page,
  }) => {
    const first = await writeFileWith(idlText("0.1.0", []))(
      page,
      "counter.json"
    );
    const second = idlText("0.2.0", ["Counts"]);
    const secondPath = await writeFileWith(second)(page, "counter-v2.json");
    await runUntil("IDL initialized.")(
      page,
      `anchor idl init --filepath ${first}`
    );

    await runUntil(`IDL upgraded. Program Metadata account: ${metadata}`)(
      page,
      `anchor idl upgrade --filepath ${secondPath}`
    );

    await runUntil(second)(page, `anchor idl fetch ${PROGRAM}`);
  });

  test("client-v2-program-idl: Publish through a buffer", async ({
    seededPage: page,
  }) => {
    const text = idlText("0.1.0", []);
    const path = await writeFileWith(text)(page, "counter.json");
    await runUntil("Buffer created successfully.")(
      page,
      `anchor idl create-buffer --filepath ${path}`
    );
    // The address ends where the prompt that follows the line begins
    const created = new RegExp(`Buffer account: (${BASE58}{32,44})\\s*\\$`);
    await expect(terminalOf(page)).toHaveText(created);
    const [, buffer] =
      created.exec((await terminalOf(page).textContent()) ?? "") ?? [];

    await runUntil("Metadata written successfully using buffer.")(
      page,
      `anchor idl write-buffer ${PROGRAM} --buffer ${buffer} --close-buffer`
    );

    await runUntil(text)(page, `anchor idl fetch ${PROGRAM}`);
    expect(cluster.svm.getAccount(address(buffer)).exists).toBe(false);
  });

  test("client-v2-program-idl: A program without a published IDL", async ({
    seededPage: page,
  }) => {
    await runUntil(
      `Program ${PROGRAM} has no published IDL on the selected network.`
    )(page, `anchor idl fetch ${PROGRAM}`);
  });

  test("client-v2-program-idl: Running init again finishes the upload", async ({
    seededPage: page,
  }) => {
    const text = idlText("0.1.0", [incompressible(3000)]);
    const path = await writeFileWith(text)(page, "large.json");
    // The first transaction turns the canonical account into a buffer; the RPC drops the second
    cluster.dropSendAt(1);
    await runUntil("Run the same `anchor idl init` again to finish it.")(
      page,
      `anchor idl init --filepath ${path}`
    );

    await runUntil("IDL initialized.")(
      page,
      `anchor idl init --filepath ${path}`
    );

    const account = cluster.svm.getAccount(address(metadata));
    expect(account.exists && account.data[0]).toBe(
      AccountDiscriminator.Metadata
    );
    // The IDL outgrows the rows in view, so its end stands for it
    await runUntil(text.slice(-60))(page, `anchor idl fetch ${PROGRAM}`);
  });

  test("client-v2-program-idl: Help lists two legacy subcommands", async ({
    seededPage: page,
  }) => {
    const line = "anchor legacy-idl --help";
    await runInTerminal(page, line);

    /** What the line printed, up to the prompt after it */
    const printed = async () => {
      const text = (await terminalOf(page).textContent()) ?? "";
      return text.slice(text.lastIndexOf(line) + line.length);
    };
    await expect.poll(printed, LONG).toMatch(/Commands:[\s\S]*\$\s*$/);
    const help = await printed();
    const commands = help.slice(help.indexOf("Commands:"));
    expect(commands).toMatch(/\bclose\b[\s\S]*\bfetch\b/);
    for (const name of [
      "init",
      "upgrade",
      "authority",
      "write-buffer",
      "set-buffer",
      "set-authority",
      "erase-authority",
    ]) {
      expect(commands).not.toContain(name);
    }
  });
});
