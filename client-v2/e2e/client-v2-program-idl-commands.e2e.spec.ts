import type { Page } from "@playwright/test";
import { type Address, address, lamports } from "@solana/kit";
import type { Keypair } from "@solana/web3.js";
import {
  AccountDiscriminator,
  findCanonicalPda,
  getBufferDecoder,
} from "@solana-program/program-metadata";

import { clusterOf } from "../src/commands/anchor/__fixtures__/cluster";
import { expect, json, LONG, test } from "./fixtures";
import {
  BASE58,
  type Cluster,
  connectedWallet,
  DEVNET,
  disconnectedWallet,
  feeOf,
  idlText,
  idlTextFor,
  incompressible,
  keypairOf,
  LOCALNET,
  MAINNET,
  type Network,
  openTerminal,
  printedBy,
  PROGRAM,
  recordClipboardWrites,
  runAndWaitFor,
  selectNetworkAndWalletFor,
  serveFor,
  type StoredWallet,
  terminalOf,
  writeFileWith,
} from "./program-idl";
import { lineOf, linesOn, linesRead } from "./telemetry";

// The `client-v2-program-idl` scenarios on Devnet, Mainnet and Localnet, served by LiteSVM; a second file so the suite's shards split the time

const AUTHORITY = keypairOf(1);
const OTHER = keypairOf(3);
const NEW_AUTHORITY = keypairOf(4).publicKey.toBase58();
const UNDEPLOYED = keypairOf(5);
/** A second program whose upgrade authority is {@link AUTHORITY} */
const SECOND = address(keypairOf(6).publicKey.toBase58());

const AUTHORITY_ADDRESS = address(AUTHORITY.publicKey.toBase58());

/** The IDL the project's build gives it */
const PROJECT_IDL = idlText("0.1.0", ["The project's IDL"]);

const WALLET_QUESTION = "No wallet is connected";

/** Runs `line` until the terminal prints the refusal of an IDL write on mainnet-beta */
const refusedOnMainnet = runAndWaitFor(
  "Writing an IDL to mainnet is not available"
);

/** An Anchor 0.29 IDL */
const LEGACY_IDL = {
  version: "0.1.0",
  name: "counter",
  instructions: [{ name: "increment", args: [], accounts: [] }],
};

/** The `idl_command_failed` lines among the slice's telemetry lines, in the order they were sent */
const failuresIn = (lines: string[]) =>
  lines.filter((line) =>
    line.startsWith("[telemetry:event] idl_command_failed ")
  );

const canonicalOf = async (program: Address) => {
  const [pda] = await findCanonicalPda({ program, seed: "idl" });
  return pda;
};

/** The program's Program id block in the Deploy stage */
const programIdBlock = (page: Page) =>
  page
    .locator("#flow-stage-panel-deploy")
    .getByRole("region", { name: "Program id", exact: true });

/** Gives the project `keypair` as its program keypair, through the Deploy stage's import */
const importProgramKeypair = async (page: Page, keypair: Keypair) => {
  await page.locator("#flow-stage-tab-deploy").click();
  const block = programIdBlock(page);
  await expect(block).toBeVisible(LONG);
  const field = block.getByRole("textbox", { name: "Program id", exact: true });
  if (!(await field.isVisible())) {
    await block
      .getByRole("button", { name: "Program id", exact: true })
      .click();
  }
  await expect(field).toBeVisible();
  await block
    .locator('[data-slot="drop-zone"] input[type="file"]')
    .setInputFiles({
      name: "program-keypair.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(Array.from(keypair.secretKey))),
    });
  // A project that already holds a keypair asks before it replaces it
  const replace = page.getByRole("dialog", {
    name: "Replace the program keypair?",
  });
  const wanted = keypair.publicKey.toBase58();
  await expect
    .poll(
      async () =>
        (await replace.isVisible()) || (await field.inputValue()) === wanted
    )
    .toBe(true);
  if (await replace.isVisible()) {
    await replace.getByRole("button", { name: "Replace" }).click();
  }
  await expect(field).toHaveValue(wanted);
};

/** Builds the project as a user does, with the build server's answer carrying `idl`; a project without a program keypair gets one */
const buildWithIdl = async (page: Page, idl: string) => {
  // CI has no build server: the request is answered here
  await page.route("**/build", (route) =>
    // eslint-disable-next-line unicorn/no-null -- the build server's wire shape
    json(route, { stderr: "", uuid: null, idl: JSON.parse(idl) })
  );
  await page.locator("#flow-stage-tab-build").click();
  const build = page.locator("#flow-stage-panel-build");
  await build.getByRole("button", { name: /^Build$/ }).click();
  await expect(
    build.getByRole("heading", { name: "Build succeeded" })
  ).toBeVisible(LONG);
  await openTerminal(page);
};

/** A project whose program id is `keypair`'s and whose latest IDL is `idl` */
const buildProjectWith =
  (idl: string) => async (page: Page, keypair: Keypair) => {
    await importProgramKeypair(page, keypair);
    await buildWithIdl(page, idl);
  };

/** The address a `create-buffer` line printed, which ends where the prompt after it begins */
const createdBuffer = async (page: Page) => {
  const created = new RegExp(`Buffer account: (${BASE58}{32,44})\\s*\\$`);
  await expect(terminalOf(page)).toHaveText(created, LONG);
  const [, buffer] =
    created.exec((await terminalOf(page).textContent()) ?? "") ?? [];
  return address(buffer);
};

/** The names a usage lists under `Commands:`: the first word of each line at the list's own indent, not a wrapped description's */
const commandsIn = (usage: string) => {
  const lines = usage
    .slice(usage.indexOf("Commands:") + "Commands:".length)
    .split("\n")
    .filter((line) => line.trim() !== "");
  const indentOf = (line: string) => line.length - line.trimStart().length;
  const indent = Math.min(...lines.map(indentOf));
  return lines
    .filter((line) => indentOf(line) === indent)
    .map((line) => line.trim().split(/\s/)[0]);
};

test.describe("client-v2-program-idl", () => {
  let cluster: Cluster;
  let metadata: Address;
  // Set before any hook runs, so a setup that fails before `serveFor` reports its own error here
  let unanswered = new Set<string>();

  /** Serves `network` from the test's cluster, selects it and `wallet`, and opens the terminal */
  const openFor =
    (network: Network) => async (page: Page, wallet: StoredWallet) => {
      unanswered = await serveFor(network)(cluster)(page);
      await recordClipboardWrites(page);
      await selectNetworkAndWalletFor(network)(page, wallet);
      await openTerminal(page);
    };
  const openOnDevnet = openFor(DEVNET);

  /** Connects `wallet` in place of the one connected, on Devnet; the cluster keeps its state across the reload */
  const switchWallet = async (page: Page, wallet: StoredWallet) => {
    await selectNetworkAndWalletFor(DEVNET)(page, wallet);
    await openTerminal(page);
  };

  /** The lamports `at` holds, or none for an account that does not exist */
  const lamportsAt = (at: Address) => {
    const account = cluster.svm.getAccount(at);
    return account.exists ? account.lamports : 0n;
  };
  const balanceOf = (at: Address) => cluster.svm.getBalance(at) ?? 0n;
  /** The fee of the last transaction the cluster received */
  const lastFee = () => {
    const last = cluster.sent.at(-1);
    if (!last) throw new Error("The cluster received no transaction");
    return feeOf(last);
  };

  /** Publishes `text` from a project file with `anchor idl init`, as the connected upgrade authority */
  const publish = async (page: Page, text: string) => {
    const path = await writeFileWith(text)(page, "counter.json");
    await runAndWaitFor("IDL initialized.")(
      page,
      `anchor idl init --filepath ${path}`
    );
  };

  test.beforeEach(async () => {
    cluster = clusterOf();
    for (const wallet of [AUTHORITY, OTHER]) {
      cluster.svm.airdrop(
        address(wallet.publicKey.toBase58()),
        lamports(10_000_000_000n)
      );
    }
    await cluster.deploy(PROGRAM, AUTHORITY.publicKey.toBase58());
    metadata = await canonicalOf(PROGRAM);
  });

  // A method nobody answered is a request the browser path makes and this file does not serve
  test.afterEach(() => {
    const seen = Array.from(unanswered);
    unanswered = new Set();
    expect(seen).toEqual([]);
  });

  test("client-v2-program-idl: Help lists the subcommands", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));

    const commands = commandsIn(await printedBy(page, "anchor idl --help"));

    expect(commands).toEqual(
      expect.arrayContaining([
        "init",
        "upgrade",
        "fetch",
        "close",
        "create-buffer",
        "set-buffer-authority",
        "write-buffer",
        "convert",
        "type",
        "build",
        "fetch-historical",
      ])
    );
    expect(commands).toHaveLength(11);
    for (const name of [
      "authority",
      "set-authority",
      "erase-authority",
      "set-buffer",
    ]) {
      expect(commands).not.toContain(name);
    }
  });

  test("client-v2-program-idl: A name Anchor 1.1.2 removed", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, disconnectedWallet(AUTHORITY));

    const printed = await printedBy(page, "anchor idl set-authority");

    expect(printed).toContain("Usage: anchor idl <COMMAND>");
    expect(printed).not.toContain(WALLET_QUESTION);
    expect(cluster.sent).toEqual([]);
  });

  test("client-v2-program-idl: A cluster option is refused", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));

    await runAndWaitFor("Unexpected option: `--provider.cluster`")(
      page,
      `anchor idl fetch ${PROGRAM} --provider.cluster devnet`
    );

    expect(cluster.sent).toEqual([]);
  });

  test("client-v2-program-idl: An output option writes a project file", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    const text = idlText("0.1.0", []);
    await publish(page, text);

    await runAndWaitFor("Metadata content saved to")(
      page,
      `anchor idl fetch ${PROGRAM} --out idl/fetched.json`
    );

    const tree = page.locator("#root-dir");
    const file = tree.getByText("fetched.json", { exact: true });
    if (!(await file.isVisible())) {
      await tree.getByText("idl", { exact: true }).click();
    }
    await file.click();
    await expect(page.locator(".monaco-editor .view-lines")).toContainText(
      text,
      LONG
    );
  });

  test("client-v2-program-idl: A first upload", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    await buildProjectWith(PROJECT_IDL)(page, keypairOf(2));

    await runAndWaitFor(
      `IDL initialized. Program Metadata account: ${metadata}`
    )(page, "anchor idl init");

    await runAndWaitFor(PROJECT_IDL)(page, `anchor idl fetch ${PROGRAM}`);
  });

  test("client-v2-program-idl: A failed upload names the rent it leaves", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    const lines = linesOn(page);
    const path = await writeFileWith(idlText("0.1.0", [incompressible(3000)]))(
      page,
      "large.json"
    );
    // The first transaction turns the canonical account into a buffer; the RPC drops the second
    cluster.dropSendAt(1);

    await runAndWaitFor("Run the same `anchor idl init` again to finish it.")(
      page,
      `anchor idl init --filepath ${path}`
    );

    const sol = Number(lamportsAt(metadata)) / 1e9;
    const unfinished = `An unfinished upload holds ${sol} SOL at ${metadata}. Run the same \`anchor idl init\` again to finish it.`;
    const printed = (await terminalOf(page).textContent()) ?? "";
    expect(printed).toContain(unfinished);
    expect(printed.indexOf("Node is behind")).toBeGreaterThan(-1);
    expect(printed.indexOf("Node is behind")).toBeLessThan(
      printed.indexOf(unfinished)
    );
    await expect
      .poll(() => lineOf(lines, "idl_upload_failed"), LONG)
      .toContain("reason: unfinished");
  });

  test.describe("after an upload the RPC failed once its first transaction landed", () => {
    const text = idlText("0.1.0", [incompressible(3000)]);

    test.beforeEach(async ({ seededPage: page }) => {
      await openOnDevnet(page, connectedWallet(AUTHORITY));
      const path = await writeFileWith(text)(page, "large.json");
      cluster.dropSendAt(1);
      await runAndWaitFor("Run the same `anchor idl init` again to finish it.")(
        page,
        `anchor idl init --filepath ${path}`
      );
    });

    test("client-v2-program-idl: Fetch does not print a buffer", async ({
      seededPage: page,
    }) => {
      const printed = await printedBy(page, `anchor idl fetch ${PROGRAM}`);

      const [none, unfinished, ...rest] = printed.split("\n");
      expect(none).toBe(
        `Program ${PROGRAM} has no published IDL on the selected network.`
      );
      expect(unfinished).toMatch(/^An upload of its IDL is unfinished/);
      expect(rest).toEqual([]);
    });

    test("client-v2-program-idl: Close recovers the rent of an unfinished upload", async ({
      seededPage: page,
    }) => {
      const rent = lamportsAt(metadata);
      const before = balanceOf(AUTHORITY_ADDRESS);

      await runAndWaitFor("Metadata account closed successfully.")(
        page,
        `anchor idl close ${PROGRAM}`
      );

      expect(cluster.svm.getAccount(metadata).exists).toBe(false);
      expect(balanceOf(AUTHORITY_ADDRESS)).toBe(before + rent - lastFee());
    });
  });

  test("client-v2-program-idl: A program id argument", async ({
    seededPage: page,
  }) => {
    await cluster.deploy(SECOND, AUTHORITY.publicKey.toBase58());
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    await buildProjectWith(PROJECT_IDL)(page, keypairOf(2));

    await runAndWaitFor("IDL initialized.")(page, `anchor idl init ${SECOND}`);

    const written = cluster.svm.getAccount(await canonicalOf(SECOND));
    expect(written.exists && written.data[0]).toBe(
      AccountDiscriminator.Metadata
    );
    expect(cluster.svm.getAccount(metadata).exists).toBe(false);
  });

  test("client-v2-program-idl: The address of an IDL file", async ({
    seededPage: page,
  }) => {
    await cluster.deploy(SECOND, AUTHORITY.publicKey.toBase58());
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    // Written before the Deploy stage opens, since a file the Files column creates opens in the editor
    const path = await writeFileWith(idlTextFor(SECOND)("0.1.0", []))(
      page,
      "other.json"
    );
    await importProgramKeypair(page, keypairOf(2));
    await openTerminal(page);

    await runAndWaitFor("IDL initialized.")(
      page,
      `anchor idl init --filepath ${path}`
    );

    const written = cluster.svm.getAccount(await canonicalOf(SECOND));
    expect(written.exists && written.data[0]).toBe(
      AccountDiscriminator.Metadata
    );
    expect(cluster.svm.getAccount(metadata).exists).toBe(false);
  });

  test("client-v2-program-idl: No program id to write for", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    const lines = linesOn(page);

    await runAndWaitFor(
      "The project has no program ID. Build the program first, or pass a program ID."
    )(page, "anchor idl init");

    expect(cluster.sent).toEqual([]);
    await linesRead(lines);
    expect(lineOf(lines, "idl_upload_started")).toBeUndefined();
  });

  test("client-v2-program-idl: A wallet that is not the authority publishes its own IDL", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(OTHER));
    await buildWithIdl(page, PROJECT_IDL);

    await runAndWaitFor("IDL initialized.")(
      page,
      `anchor idl init --non-canonical ${PROGRAM}`
    );

    await runAndWaitFor(PROJECT_IDL)(
      page,
      `anchor idl fetch ${PROGRAM} --non-canonical`
    );
  });

  test("client-v2-program-idl: The upgrade authority asks for a non-canonical account", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    await buildWithIdl(page, PROJECT_IDL);

    await runAndWaitFor("Run the command without `--non-canonical`.")(
      page,
      `anchor idl init --non-canonical ${PROGRAM}`
    );

    expect(cluster.sent).toEqual([]);
  });

  test("client-v2-program-idl: Init on Localnet", async ({
    seededPage: page,
  }) => {
    await openFor(LOCALNET)(page, connectedWallet(AUTHORITY));

    await runAndWaitFor("Skipping IDL initialization on localnet")(
      page,
      "anchor idl init"
    );

    expect(cluster.sent).toEqual([]);
  });

  test("client-v2-program-idl: No IDL in the project", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    await importProgramKeypair(page, keypairOf(2));
    await openTerminal(page);

    await runAndWaitFor("The project has no IDL to upload.")(
      page,
      "anchor idl init"
    );

    expect(cluster.sent).toEqual([]);
  });

  test("client-v2-program-idl: A missing IDL file", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));

    await runAndWaitFor("The project has no IDL file at idl/none.json.")(
      page,
      "anchor idl init --filepath idl/none.json"
    );

    expect(cluster.sent).toEqual([]);
  });

  test("client-v2-program-idl: An Anchor 0.29 IDL", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    await buildWithIdl(page, JSON.stringify(LEGACY_IDL));

    await runAndWaitFor("The project's IDL is not in the Anchor 0.30+ format.")(
      page,
      "anchor idl init"
    );

    expect(cluster.sent).toEqual([]);
  });

  test("client-v2-program-idl: A wallet that is not the authority", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(OTHER));
    await buildProjectWith(PROJECT_IDL)(page, keypairOf(2));

    await runAndWaitFor(
      `The program's upgrade authority is ${AUTHORITY_ADDRESS}.`
    )(page, "anchor idl upgrade");

    expect(cluster.sent).toEqual([]);
  });

  test("client-v2-program-idl: A program that is not deployed", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    await buildProjectWith(PROJECT_IDL)(page, UNDEPLOYED);

    await runAndWaitFor(
      `Program ${UNDEPLOYED.publicKey.toBase58()} is not deployed on the selected network.`
    )(page, "anchor idl init");

    expect(cluster.sent).toEqual([]);
  });

  test("client-v2-program-idl: Fetch after an upload", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    const text = idlText("0.1.0", []);
    await publish(page, text);
    await runAndWaitFor("Disconnected.")(page, "connect");

    const printed = await printedBy(page, `anchor idl fetch ${PROGRAM}`);

    expect(printed).toBe(text);
    expect(printed).not.toContain(WALLET_QUESTION);
  });

  test("client-v2-program-idl: Close returns the rent", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    await publish(page, idlText("0.1.0", []));
    const rent = lamportsAt(metadata);
    const before = balanceOf(AUTHORITY_ADDRESS);

    await runAndWaitFor("Metadata account closed successfully.")(
      page,
      `anchor idl close ${PROGRAM}`
    );

    expect(balanceOf(AUTHORITY_ADDRESS)).toBe(before + rent - lastFee());
    await runAndWaitFor(
      `Program ${PROGRAM} has no published IDL on the selected network.`
    )(page, `anchor idl fetch ${PROGRAM}`);
  });

  test("client-v2-program-idl: Close by another wallet", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    await publish(page, idlText("0.1.0", []));
    await switchWallet(page, connectedWallet(OTHER));
    const sent = cluster.sent.length;

    await runAndWaitFor(
      `The program's upgrade authority is ${AUTHORITY_ADDRESS}.`
    )(page, `anchor idl close ${PROGRAM}`);

    expect(cluster.sent).toHaveLength(sent);
    expect(cluster.svm.getAccount(metadata).exists).toBe(true);
  });

  test("client-v2-program-idl: A buffer from the project's IDL", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    await buildWithIdl(page, PROJECT_IDL);

    await runAndWaitFor("Buffer created successfully.")(
      page,
      "anchor idl create-buffer"
    );

    const account = cluster.svm.getAccount(await createdBuffer(page));
    if (!account.exists) throw new Error("The buffer does not exist");
    expect(account.data[0]).toBe(AccountDiscriminator.Buffer);
    expect(getBufferDecoder().decode(account.data).authority).toEqual({
      __option: "Some",
      value: AUTHORITY_ADDRESS,
    });
  });

  test("client-v2-program-idl: A buffer gets a new authority", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    const path = await writeFileWith(idlText("0.1.0", []))(
      page,
      "counter.json"
    );
    await runAndWaitFor("Buffer created successfully.")(
      page,
      `anchor idl create-buffer --filepath ${path}`
    );
    const buffer = await createdBuffer(page);

    await runAndWaitFor("Buffer authority set successfully.")(
      page,
      `anchor idl set-buffer-authority ${buffer} --new-authority ${NEW_AUTHORITY}`
    );

    const account = cluster.svm.getAccount(buffer);
    if (!account.exists) throw new Error("The buffer does not exist");
    expect(getBufferDecoder().decode(account.data).authority).toEqual({
      __option: "Some",
      value: NEW_AUTHORITY,
    });
  });

  test("client-v2-program-idl: anchor idl build", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, disconnectedWallet(AUTHORITY));

    const printed = await printedBy(page, "anchor idl build");

    expect(printed).toContain(
      "The Playground terminal does not support `anchor idl build` yet."
    );
    expect(printed).not.toContain(WALLET_QUESTION);
    expect(cluster.sent).toEqual([]);
  });

  test("client-v2-program-idl: anchor idl convert and type", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, disconnectedWallet(AUTHORITY));
    const lines = linesOn(page);

    const convert = await printedBy(
      page,
      "anchor idl convert idl/counter.json"
    );
    const type = await printedBy(page, "anchor idl type idl/counter.json");

    expect(convert).toContain(
      "The Playground terminal does not support `anchor idl convert` yet."
    );
    expect(type).toContain(
      "The Playground terminal does not support `anchor idl type` yet."
    );
    expect(`${convert}\n${type}`).not.toContain(WALLET_QUESTION);
    await expect
      .poll(() => failuresIn(lines), LONG)
      .toEqual([
        expect.stringContaining(
          "{command: convert, cluster: devnet, reason: unsupported}"
        ),
        expect.stringContaining(
          "{command: type, cluster: devnet, reason: unsupported}"
        ),
      ]);
    await linesRead(lines);
    expect(lineOf(lines, "idl_command_started")).toBeUndefined();
    expect(cluster.sent).toEqual([]);
  });

  test("client-v2-program-idl: anchor legacy-idl", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, disconnectedWallet(AUTHORITY));
    const lines = linesOn(page);

    const printed = await printedBy(page, `anchor legacy-idl fetch ${PROGRAM}`);

    expect(printed).toContain(
      "The Playground terminal does not support `anchor legacy-idl` yet."
    );
    expect(printed).not.toContain(WALLET_QUESTION);
    await expect
      .poll(() => lineOf(lines, "idl_command_failed"), LONG)
      .toContain("{command: legacy-idl, cluster: devnet, reason: unsupported}");
    await linesRead(lines);
    expect(lineOf(lines, "idl_command_started")).toBeUndefined();
    expect(cluster.sent).toEqual([]);
  });

  test("client-v2-program-idl: A successful upload is tracked", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    await buildProjectWith(PROJECT_IDL)(page, keypairOf(2));
    const lines = linesOn(page);

    await runAndWaitFor("IDL initialized.")(page, "anchor idl init");

    await expect
      .poll(() => lineOf(lines, "idl_uploaded"), LONG)
      .toContain("{target: metadata, cluster: devnet}");
    expect(lineOf(lines, "idl_upload_started")).toContain(
      "{target: metadata, cluster: devnet}"
    );
    expect(
      lines.indexOf(lineOf(lines, "idl_upload_started") ?? "")
    ).toBeLessThan(lines.indexOf(lineOf(lines, "idl_uploaded") ?? ""));
  });

  test("client-v2-program-idl: A mainnet refusal is tracked", async ({
    seededPage: page,
  }) => {
    await openFor(MAINNET)(page, connectedWallet(AUTHORITY));
    const lines = linesOn(page);

    await refusedOnMainnet(page, "anchor idl init");

    await expect
      .poll(() => lineOf(lines, "idl_upload_failed"), LONG)
      .toContain("{target: metadata, cluster: mainnet-beta, reason: mainnet}");
    expect(lineOf(lines, "idl_upload_started")).toContain(
      "{target: metadata, cluster: mainnet-beta}"
    );
    expect(
      lines.indexOf(lineOf(lines, "idl_upload_started") ?? "")
    ).toBeLessThan(lines.indexOf(lineOf(lines, "idl_upload_failed") ?? ""));
    expect(cluster.sent).toEqual([]);
  });

  test("client-v2-program-idl: A wrong wallet is tracked", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(OTHER));
    await buildProjectWith(PROJECT_IDL)(page, keypairOf(2));
    const lines = linesOn(page);

    await runAndWaitFor(
      `The program's upgrade authority is ${AUTHORITY_ADDRESS}.`
    )(page, "anchor idl init");

    await expect
      .poll(() => lineOf(lines, "idl_upload_failed"), LONG)
      .toContain("{target: metadata, cluster: devnet, reason: authority}");
  });

  test("client-v2-program-idl: A fetch is tracked", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    const text = idlText("0.1.0", []);
    await publish(page, text);
    const lines = linesOn(page);

    await runAndWaitFor(text)(page, `anchor idl fetch ${PROGRAM}`);

    await expect
      .poll(() => lineOf(lines, "idl_command_succeeded"), LONG)
      .toContain("{command: fetch, cluster: devnet}");
    expect(lineOf(lines, "idl_command_started")).toContain(
      "{command: fetch, cluster: devnet}"
    );
    expect(
      lines.indexOf(lineOf(lines, "idl_command_started") ?? "")
    ).toBeLessThan(lines.indexOf(lineOf(lines, "idl_command_succeeded") ?? ""));
  });

  test("client-v2-program-idl: A close refused on mainnet is tracked", async ({
    seededPage: page,
  }) => {
    await openFor(MAINNET)(page, connectedWallet(AUTHORITY));
    const lines = linesOn(page);

    await refusedOnMainnet(page, `anchor idl close ${PROGRAM}`);

    await expect
      .poll(() => lineOf(lines, "idl_command_failed"), LONG)
      .toContain("{command: close, cluster: mainnet-beta, reason: mainnet}");
    expect(lineOf(lines, "idl_command_started")).toContain(
      "{command: close, cluster: mainnet-beta}"
    );
    expect(
      lines.indexOf(lineOf(lines, "idl_command_started") ?? "")
    ).toBeLessThan(lines.indexOf(lineOf(lines, "idl_command_failed") ?? ""));
    expect(cluster.sent).toEqual([]);
  });

  test("client-v2-program-idl: A fetch without a published IDL is tracked", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    const lines = linesOn(page);

    await runAndWaitFor(
      `Program ${PROGRAM} has no published IDL on the selected network.`
    )(page, `anchor idl fetch ${PROGRAM}`);

    await expect
      .poll(() => lineOf(lines, "idl_command_failed"), LONG)
      .toContain("{command: fetch, cluster: devnet, reason: not_found}");
  });

  test("client-v2-program-idl: An unsupported subcommand is tracked", async ({
    seededPage: page,
  }) => {
    await openOnDevnet(page, connectedWallet(AUTHORITY));
    const lines = linesOn(page);

    await runAndWaitFor("does not support `anchor idl fetch-historical`")(
      page,
      `anchor idl fetch-historical ${PROGRAM}`
    );

    await expect
      .poll(() => lineOf(lines, "idl_command_failed"), LONG)
      .toContain(
        "{command: fetch-historical, cluster: devnet, reason: unsupported}"
      );
    await linesRead(lines);
    expect(lineOf(lines, "idl_command_started")).toBeUndefined();
  });
});
