import { PgCommon, PgSettings, PgTerminal, PgWallet } from "../../utils";
import { TerminalLineError } from "../../utils/terminal/line-error";
import { checkPgWallet } from "../checks";
import { createArgs, createCmd, createOptions, createSubcmd } from "../create";
import {
  closeBuffersWith,
  fetchBuffersWith,
  formatBuffersTable,
} from "./buffers";
import { clientWith } from "./client";
import { getCloser } from "./closer";
import { confirmVerboseWith, confirmWith } from "./confirm";
import { normalizeToUrlIfMoniker } from "./url";

/** What `-u` is described as, on `solana` and on each subcommand */
const URL_DESCRIPTION =
  "RPC URL or cluster (m, t, d, l, or mainnet-beta, testnet, devnet, localhost); defaults to the selected endpoint";

/**
 * The `-u`/`--url` option, declared by `solana` and by every subcommand that
 * runs: the parser hands the option to the subcommand that runs
 * (`hoistParentOptionsWith`), so `solana -u d confirm …` and `solana confirm
 * -u d …` both work, and a leaf without it fails the first with "Unexpected
 * option". `solana-command.test.ts` checks that every leaf declares it.
 */
const URL_OPTION = {
  name: "url",
  short: "u",
  takeValue: true,
  description: URL_DESCRIPTION,
} as const;

/** The client for `-u`'s cluster or URL, or for the endpoint selected in the app when it is not given */
const getClient = (url: string | undefined) => {
  const { endpoint, commitment } = PgSettings.connection;
  return clientWith(commitment)(
    url === undefined ? endpoint : normalizeToUrlIfMoniker(url)
  );
};

const printLines = async (lines: readonly string[]) => {
  for (const line of lines) await PgTerminal.println(line);
};

/** The error of `program show` and `program close` without `--buffers`: closing a program is not offered */
const requireBuffers = (subcommand: string) =>
  new Error(
    `\`--buffers\` is required: \`solana program ${subcommand}\` works on buffers only. Run \`solana program ${subcommand} --buffers\`.`
  );

/** The Playground Wallet the wallet check connected */
const getWallet = () => {
  const wallet = PgWallet.current;
  if (!wallet?.isPg) {
    throw new TerminalLineError(
      "Your Playground wallet is not connected. Run `connect` to connect it."
    );
  }
  return wallet;
};

const confirm = createSubcmd({
  name: "confirm",
  description: "Confirm transaction by signature",
  args: createArgs([
    { name: "signature", description: "The transaction signature to confirm" },
  ]),
  options: createOptions([
    {
      name: "verbose",
      short: "v",
      description: "Show the transaction's details",
    },
    URL_OPTION,
  ]),
  handle: async (input) => {
    const client = getClient(input.options.url);
    const confirmSignature = input.options.verbose
      ? confirmVerboseWith(client)
      : confirmWith(client);

    await printLines(await confirmSignature(input.args.signature));
  },
});

const show = createSubcmd({
  name: "show",
  description: "Show the wallet's buffers",
  options: createOptions([
    {
      name: "buffers",
      description: "Show the buffers the wallet is the authority of",
    },
    URL_OPTION,
  ]),
  handle: async (input) => {
    if (!input.options.buffers) throw requireBuffers("show");

    const buffers = await fetchBuffersWith(getClient(input.options.url))(
      getWallet().publicKey.toBase58()
    );
    await PgTerminal.printlnBuffersTable(formatBuffersTable(buffers));
  },
});

const close = createSubcmd({
  name: "close",
  description: "Close the wallet's buffers and take back their SOL",
  options: createOptions([
    {
      name: "buffers",
      description: "Close the buffers the wallet is the authority of",
    },
    URL_OPTION,
  ]),
  handle: async (input) => {
    if (!input.options.buffers) throw requireBuffers("close");

    const { closed, skipped } = await closeBuffersWith(
      getClient(input.options.url)
    )((ms) => PgCommon.sleep(ms))(getCloser(getWallet()));

    for (const { buffer, reason } of skipped) {
      await PgTerminal.println(
        PgTerminal.warning(`Could not close ${buffer.address}: ${reason}`)
      );
    }
    // No table when buffers were found and none closed: "No buffers." would read as nothing left to reclaim
    if (closed.length || !skipped.length) {
      await PgTerminal.printlnBuffersTable(formatBuffersTable(closed));
    }
    if (skipped.length) {
      throw new Error(
        `Closed ${closed.length} of ${closed.length + skipped.length} buffers.`
      );
    }
  },
});

const program = createSubcmd({
  name: "program",
  description: "Program management",
  // Only `program` asks for the wallet: `confirm` and a mistyped subcommand ask nothing
  preChecks: checkPgWallet,
  subcommands: [show, close],
});

const subcommands = [confirm, program];

export const solana = createCmd({
  name: "solana",
  description: "Commands for interacting with Solana",
  needsConnection: true,
  options: createOptions([URL_OPTION]),
  subcommands,
  // A bare `solana` lists its subcommands; the parser names an unknown one first
  handle: async () => {
    await PgTerminal.println(`
Commands for interacting with Solana

Usage: solana <COMMAND>

Commands:

${PgTerminal.formatList(subcommands)}`);
  },
});
