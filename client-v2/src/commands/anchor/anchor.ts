import { isAddress } from "@solana/kit";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { isIdlV1 } from "@/entities/idl";
import {
  closeMetadataAccountWith,
  createIdlBufferWith,
  DEFAULT_PRIORITY_FEE,
  fetchPublishedIdl,
  IDL_SEED,
  IdlCommandRefusedError,
  type IdlSend,
  IdlSendExpiredError,
  type IdlSource,
  setBufferAuthorityWith,
  trackRefusedIdlSendFor,
  trackUnsupportedIdlCommand,
  UnfinishedIdlUploadError,
  uploadNonCanonicalProjectIdlWith,
  uploadProjectIdlWith,
  writeMetadataFromBufferWith,
} from "@/features/program-idl";
import { createLogger } from "@/shared/lib/logger";

import {
  PgCommandManager,
  PgConnection,
  PgExplorer,
  PgGlobal,
  PgProgramInfo,
  PgTerminal,
  PgWallet,
  TerminalLineError,
} from "../../utils";
import { applyFile } from "../../utils/explorer/apply-file";
import { processErrorLine } from "../../utils/terminal/line-error";
import { checkWallet } from "../checks";
import { createArgs, createCmd, createOptions, createSubcmd } from "../create";
import { refuseMainnetWith } from "../deploy/check-not-mainnet";
import {
  IDL_NETWORK_CHANGED,
  IDL_REFUSAL,
  MAINNET_IDL_BLOCKED,
} from "../deploy/mainnet-block";

const log = createLogger("commands:anchor");

const refuseIdlWriteOnMainnet = refuseMainnetWith(IDL_REFUSAL);

/** Whether {@link refuseIdlWriteOnMainnet} refused mainnet-beta, and not an endpoint whose network it could not read */
const isMainnetRefusal = (error: unknown) =>
  error instanceof TerminalLineError && error.message === MAINNET_IDL_BLOCKED;

/** What Anchor 1.1.2 prints for `init` and for `upgrade`, which run the same write */
const UPLOAD_LINES = {
  init: {
    skipped: "Skipping IDL initialization on localnet",
    done: "IDL initialized.",
  },
  upgrade: {
    skipped: "Skipping IDL upgrade on localnet",
    done: "IDL upgraded.",
  },
} as const;

/** The line of a send's failure: an expiry's message is the whole line, any other failure's follows "Process error:" */
const toFailureLine = (error: unknown) =>
  error instanceof IdlSendExpiredError
    ? error.message
    : processErrorLine(error);

/** The failure's line, then the line saying what the buffer it left holds and what to run next */
const toUnfinishedUploadLine =
  (name: string) => (error: UnfinishedIdlUploadError) => {
    const { kind, address, lamports } = error.leftover;
    const sol = Number(lamports) / LAMPORTS_PER_SOL;
    // Only a buffer at the metadata account's address is one that running the subcommand again reaches
    const next =
      kind === "metadata"
        ? `An unfinished upload holds ${sol} SOL at ${address}. Run the same \`anchor idl ${name}\` again to finish it.`
        : `A buffer the failed send created holds ${sol} SOL at ${address}, and no terminal command closes it. Run the same \`anchor idl ${name}\` again.`;
    return new TerminalLineError(`${toFailureLine(error.cause)}\n${next}`, {
      cause: error,
    });
  };

/** Runs `run`, and turns an unfinished upload of the subcommand `name` into the lines the terminal prints */
const withUnfinishedLineFor =
  (name: string) =>
  async <Result>(run: () => Promise<Result>) => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof UnfinishedIdlUploadError) {
        throw toUnfinishedUploadLine(name)(error);
      }
      throw error;
    }
  };

/** Stands for the program id of an upload that the slice refuses before it reads the id */
const UNREAD_PROGRAM_ID = "";

const parseAddress = (token: string) => {
  if (isAddress(token)) return token;
  throw new Error("expected a base58 address");
};

const parsePriorityFee = (token: string) => {
  if (/^\d+$/.test(token)) return BigInt(token);
  throw new Error("expected a whole number of micro-lamports per compute unit");
};

const programIdArg = {
  name: "program_id",
  description: "The program ID",
  optional: true, // The handler requires it, after the line's `--help` is read: see `requireArg`
  parse: parseAddress,
} as const;

const filepathOption = {
  name: "filepath",
  short: "f",
  description:
    "IDL file of the project (default: the latest IDL uploaded to the project)",
  takeValue: true,
} as const;

const outOption = {
  name: "out",
  short: "o",
  description: "Output file of the project (the terminal if not specified)",
  takeValue: true,
} as const;

const priorityFeeOption = {
  name: "priority-fee",
  description: "Priority fees in micro-lamports per compute unit",
  takeValue: true,
  parse: parsePriorityFee,
} as const;

const seedOption = {
  name: "seed",
  description: `The seed of the metadata account (default: "${IDL_SEED}")`,
  takeValue: true,
} as const;

/** The price a subcommand that sends pays for each compute unit */
const getPriorityFee = (options: { "priority-fee"?: bigint }) =>
  options["priority-fee"] ?? DEFAULT_PRIORITY_FEE;

/** The value of an argument or option Anchor requires, in the words of the terminal's parser for a missing argument */
const requireWith =
  (kind: "Argument" | "Option") =>
  <Value>(name: string, value: Value | undefined) => {
    if (value === undefined) {
      throw new Error(`${kind} not specified: \`${name}\``);
    }
    return value;
  };

/** Required here, not by the terminal's parser, which refuses a missing argument before a handler can read the line's `--help` */
const requireArg = requireWith("Argument");

/** The terminal's parser knows no required option */
const requireOption = requireWith("Option");

/** Whether a line asks for a usage as clap reads it: `--help` or `-h` as a token, in any position */
const asksForHelp = (raw: string) =>
  raw.split(" ").some((token) => token === "--help" || token === "-h");

/**
 * Runs the handler of the `anchor idl` subcommand `name`, or for a line `raw`
 * that asks for help in any position prints that subcommand's usage and does
 * nothing else. The terminal's parser reads `--help` only right after the name.
 */
const runUnlessHelpFor =
  (name: string, raw: string) =>
  async <Result>(run: () => Promise<Result>) => {
    if (!asksForHelp(raw)) return run();
    // Run as the one line the parser prints a usage for, so that a subcommand has one usage
    await PgCommandManager.execute(["anchor", "idl", name, "--help"]);
    return undefined;
  };

/** Anchor's test for a local validator, which `init` and `upgrade` skip */
const isLocalnet = (rpcEndpoint: string) =>
  rpcEndpoint.includes("localhost") || rpcEndpoint.includes("127.0.0.1");

/** The connected wallet, after the wallet question when none is connected */
const requireWallet = async () => {
  await checkWallet();
  const wallet = PgWallet.current;
  if (!wallet) throw new Error("No wallet is connected.");
  return wallet;
};

/** Runs `run`, and turns a refusal or an expired send of the slice into the line the terminal prints */
const withRefusalLine = async <Result>(run: () => Promise<Result>) => {
  try {
    return await run();
  } catch (error) {
    // Their message is the whole line; thrown as it is, the terminal prints it after "Process error:"
    if (
      error instanceof IdlCommandRefusedError ||
      error instanceof IdlSendExpiredError
    ) {
      throw new TerminalLineError(error.message, { cause: error });
    }
    throw error;
  }
};

/** What a subcommand that sends runs on: the connection the network was read from, and the connected wallet */
interface Sender {
  connection: typeof PgConnection.current;
  wallet: Awaited<ReturnType<typeof requireWallet>>;
}

/**
 * Refuses a send to mainnet-beta, to an endpoint that does not say its
 * network, and after the endpoint changed, and records the attempt, which no
 * entry of the slice runs to record. Throws a {@link TerminalLineError}.
 */
const refuseNetworkFor = (send: IdlSend) => async (rpcEndpoint: string) => {
  const trackRefused = trackRefusedIdlSendFor(send);
  try {
    await refuseIdlWriteOnMainnet(rpcEndpoint);
  } catch (error) {
    trackRefused(rpcEndpoint, isMainnetRefusal(error) ? "mainnet" : "rpc");
    throw error;
  }
  // The hold covers user switches only: after any other change the selected network is not the one that was read
  if (PgConnection.current.rpcEndpoint !== rpcEndpoint) {
    trackRefused(rpcEndpoint, "rpc");
    throw new TerminalLineError(IDL_NETWORK_CHANGED);
  }
};

/**
 * Runs the subcommand that sends `send`: asks for a wallet, holds the selected
 * network, and refuses it as {@link refuseNetworkFor} does before `run` starts.
 * Throws a {@link TerminalLineError} when it refuses, or when the slice does.
 */
const runSenderFor =
  (send: IdlSend) =>
  async <Result>(run: (sender: Sender) => Promise<Result>) => {
    const wallet = await requireWallet();

    // Settings' `pickNetwork` refuses a switch the user asks for while this is set, so the selected network stays the one the subcommand sends to
    PgGlobal.isIdlWriting = true;
    try {
      const connection = PgConnection.current;
      await refuseNetworkFor(send)(connection.rpcEndpoint);
      return await withRefusalLine(() => run({ connection, wallet }));
    } finally {
      PgGlobal.isIdlWriting = false;
    }
  };

/** The IDL the project holds, or with `--filepath` the text of that file */
const getIdlSource = (filepath: string | undefined): IdlSource =>
  filepath === undefined
    ? { kind: "project", idl: PgProgramInfo.idl ?? undefined }
    : { kind: "file", filepath, text: PgExplorer.getFileContent(filepath) };

/** The IDL a file's text holds, read only for its `address`; `undefined` for text that is not JSON */
const parseFileIdl = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error) {
    // The slice refuses the text with the parser's reason, which it reads again
    log.debug("An IDL file is not JSON", {
      context: { reason: String(error) },
    });
    return undefined;
  }
};

/**
 * The program `init` and `upgrade` write for without a `PROGRAM_ID`: the
 * `address` of the IDL file, as in Anchor, or the project's program id.
 * Throws a {@link TerminalLineError} when there is neither.
 */
const getDefaultProgramId = (source: IdlSource) => {
  if (source.kind === "project") {
    const projectId = PgProgramInfo.getPkStr();
    if (projectId) return projectId;
    throw new TerminalLineError(
      "The project has no program ID. Build the program first, or pass a program ID."
    );
  }

  const idl = source.text === undefined ? undefined : parseFileIdl(source.text);
  // A missing file, text that is not JSON, and an IDL in another format are the slice's refusals, which it makes before it reads the program id
  if (!isIdlV1(idl)) return UNREAD_PROGRAM_ID;
  const { address } = idl;
  if (address !== undefined && isAddress(address)) return address;
  throw new TerminalLineError(
    `The IDL in ${source.filepath} has no valid \`address\`. Pass a program ID.`
  );
};

/** What `init` and `upgrade` take from their line */
interface IdlUpload {
  /** The subcommand and its flags as a failed upload's line tells the user to run them again */
  command: "init" | "init --non-canonical" | "upgrade";
  lines: typeof UPLOAD_LINES[keyof typeof UPLOAD_LINES];
  /** The slice's entry for the canonical account, or with `--non-canonical` for the wallet's own */
  uploadWith: typeof uploadProjectIdlWith;
  programId: string | undefined;
  filepath: string | undefined;
  priorityFee: bigint;
}

const uploadIdl = async ({
  command,
  lines,
  uploadWith,
  programId,
  filepath,
  priorityFee,
}: IdlUpload) => {
  // Anchor skips a local validator before it reads the IDL or the wallet
  if (isLocalnet(PgConnection.current.rpcEndpoint)) {
    await PgTerminal.println(lines.skipped);
    return;
  }

  await runSenderFor("upload")(async ({ connection, wallet }) => {
    const source = getIdlSource(filepath);
    const program = programId ?? getDefaultProgramId(source);
    const { metadata } = await withUnfinishedLineFor(command)(() =>
      uploadWith(priorityFee)({
        source,
        programId: program,
        connection,
        wallet,
      })
    );
    await PgTerminal.println(
      `${PgTerminal.success(lines.done)} Program Metadata account: ${metadata}`
    );
  });
};

/** Prints `text` as it is, or with `--out` creates or replaces that file of the project */
const printOrWrite = async (out: string | undefined, text: string) => {
  if (out === undefined) {
    await PgTerminal.println(text, { noColor: true });
    return;
  }
  // A name without an extension is a folder to the explorer, which would create the folder and drop the text
  if (!PgExplorer.getItemTypeFromPath(out).file) {
    throw new TerminalLineError(
      `\`--out\` takes a file name with an extension, and ${out} has none.`
    );
  }
  // `applyFile` also updates an open editor's copy, which would otherwise show the replaced text and save it back
  await applyFile(out, text);
};

/**
 * A subcommand of Anchor's under `parent` that the terminal names and does not
 * run. It declares no argument or subcommand, so every line under it, `--help`
 * included, ends the same way.
 */
const unsupportedSubcmdFor =
  (parent: "anchor" | "anchor idl") =>
  (
    name: Parameters<typeof trackUnsupportedIdlCommand>[0],
    description: string
  ) =>
    createSubcmd({
      name,
      description: `${description} (not supported yet)`,
      handle: () => {
        trackUnsupportedIdlCommand(name, PgConnection.current.rpcEndpoint);
        throw new TerminalLineError(
          `The Playground terminal does not support \`${parent} ${name}\` yet. Run it with Anchor's CLI on your own machine.`
        );
      },
    });

const unsupportedIdlSubcmd = unsupportedSubcmdFor("anchor idl");

export const anchor = createCmd({
  name: "anchor",
  description: "Anchor CLI",
  needsConnection: true,
  subcommands: [
    createSubcmd({
      name: "idl",
      description: "Commands for interacting with interface definitions",
      subcommands: [
        createSubcmd({
          name: "init",
          description: "Initializes a program's IDL account",
          args: createArgs([
            {
              name: "program_id",
              description:
                "Program id to initialize IDL for (default: the address of the IDL file, or the project's program id)",
              optional: true,
              parse: parseAddress,
            },
          ]),
          options: createOptions([
            filepathOption,
            priorityFeeOption,
            {
              name: "non-canonical",
              description:
                "Create non-canonical metadata account (third-party metadata)",
            },
          ]),
          handle: (input) =>
            runUnlessHelpFor(
              "init",
              input.raw
            )(() =>
              uploadIdl({
                command: input.options["non-canonical"]
                  ? "init --non-canonical"
                  : "init",
                lines: UPLOAD_LINES.init,
                uploadWith: input.options["non-canonical"]
                  ? uploadNonCanonicalProjectIdlWith
                  : uploadProjectIdlWith,
                programId: input.args.program_id,
                filepath: input.options.filepath,
                priorityFee: getPriorityFee(input.options),
              })
            ),
        }),

        createSubcmd({
          name: "upgrade",
          description: "Upgrades the IDL to the new file",
          args: createArgs([
            {
              name: "program_id",
              description:
                "Program id to upgrade IDL for (default: the address of the IDL file, or the project's program id)",
              optional: true,
              parse: parseAddress,
            },
          ]),
          options: createOptions([filepathOption, priorityFeeOption]),
          handle: (input) =>
            runUnlessHelpFor(
              "upgrade",
              input.raw
            )(() =>
              uploadIdl({
                command: "upgrade",
                lines: UPLOAD_LINES.upgrade,
                uploadWith: uploadProjectIdlWith,
                programId: input.args.program_id,
                filepath: input.options.filepath,
                priorityFee: getPriorityFee(input.options),
              })
            ),
        }),

        unsupportedIdlSubcmd(
          "build",
          "Generates the IDL for the program using the compilation method"
        ),

        createSubcmd({
          name: "fetch",
          description: "Fetches an IDL for the given program from a cluster",
          args: createArgs([programIdArg]),
          options: createOptions([
            outOption,
            {
              name: "non-canonical",
              description:
                "Fetch non-canonical metadata account (third-party metadata)",
            },
          ]),
          handle: (input) =>
            runUnlessHelpFor(
              "fetch",
              input.raw
            )(async () => {
              const programId = requireArg("program_id", input.args.program_id);
              // The non-canonical account is the connected wallet's own, so only that read needs a wallet
              const authority = input.options["non-canonical"]
                ? (await requireWallet()).publicKey.toBase58()
                : undefined;
              const content = await withRefusalLine(() =>
                fetchPublishedIdl({
                  programId,
                  authority,
                  connection: PgConnection.current,
                })
              );

              const { out } = input.options;
              await printOrWrite(out, content);
              // The line of the command-line client Anchor runs, which prints nothing else after it saves a file
              if (out !== undefined) {
                await PgTerminal.println(
                  `${PgTerminal.success(
                    "[Success] "
                  )}Metadata content saved to ${PgTerminal.bold(out)}`
                );
              }
            }),
        }),

        unsupportedIdlSubcmd(
          "fetch-historical",
          "Fetches historical IDL versions for the given program from a cluster"
        ),

        unsupportedIdlSubcmd(
          "convert",
          "Convert legacy IDLs (pre Anchor 0.30) to the new IDL spec"
        ),

        unsupportedIdlSubcmd("type", "Generate TypeScript type for the IDL"),

        createSubcmd({
          name: "close",
          description: "Close a metadata account and recover rent",
          args: createArgs([programIdArg]),
          options: createOptions([seedOption, priorityFeeOption]),
          handle: (input) =>
            runUnlessHelpFor(
              "close",
              input.raw
            )(async () => {
              const programId = requireArg("program_id", input.args.program_id);
              await runSenderFor("close")(async ({ connection, wallet }) => {
                await closeMetadataAccountWith(getPriorityFee(input.options))({
                  programId,
                  seed: input.options.seed ?? IDL_SEED,
                  connection,
                  wallet,
                });
                await PgTerminal.println(
                  PgTerminal.success("Metadata account closed successfully.")
                );
              });
            }),
        }),

        createSubcmd({
          name: "create-buffer",
          description: "Create a buffer account for metadata",
          options: createOptions([filepathOption, priorityFeeOption]),
          handle: (input) =>
            runUnlessHelpFor(
              "create-buffer",
              input.raw
            )(() =>
              runSenderFor("create-buffer")(async ({ connection, wallet }) => {
                const { buffer } = await withUnfinishedLineFor("create-buffer")(
                  () =>
                    createIdlBufferWith(getPriorityFee(input.options))({
                      source: getIdlSource(input.options.filepath),
                      connection,
                      wallet,
                    })
                );
                await PgTerminal.println(
                  `${PgTerminal.success(
                    "Buffer created successfully."
                  )} Buffer account: ${buffer}`
                );
              })
            ),
        }),

        createSubcmd({
          name: "set-buffer-authority",
          description: "Set a new authority on a buffer account",
          args: createArgs([
            {
              name: "buffer",
              description: "The buffer account address",
              optional: true, // The handler requires it, after the line's `--help` is read: see `requireArg`
              parse: parseAddress,
            },
          ]),
          options: createOptions([
            {
              name: "new-authority",
              short: "n",
              description: "The new authority",
              takeValue: true,
              parse: parseAddress,
            },
            priorityFeeOption,
          ]),
          handle: (input) =>
            runUnlessHelpFor(
              "set-buffer-authority",
              input.raw
            )(async () => {
              const buffer = requireArg("buffer", input.args.buffer);
              const newAuthority = requireOption(
                "new-authority",
                input.options["new-authority"]
              );
              await runSenderFor("set-buffer-authority")(
                async ({ connection, wallet }) => {
                  await setBufferAuthorityWith(getPriorityFee(input.options))({
                    buffer,
                    newAuthority,
                    connection,
                    wallet,
                  });
                  await PgTerminal.println(
                    PgTerminal.success("Buffer authority set successfully.")
                  );
                }
              );
            }),
        }),

        createSubcmd({
          name: "write-buffer",
          description: "Write metadata using a buffer account",
          args: createArgs([programIdArg]),
          options: createOptions([
            {
              name: "buffer",
              short: "b",
              description: "The buffer account address",
              takeValue: true,
              parse: parseAddress,
            },
            seedOption,
            {
              name: "close-buffer",
              description: "Close the buffer after writing",
            },
            priorityFeeOption,
          ]),
          handle: (input) =>
            runUnlessHelpFor(
              "write-buffer",
              input.raw
            )(async () => {
              const programId = requireArg("program_id", input.args.program_id);
              const buffer = requireOption("buffer", input.options.buffer);
              await runSenderFor("write-buffer")(
                async ({ connection, wallet }) => {
                  await withUnfinishedLineFor("write-buffer")(() =>
                    writeMetadataFromBufferWith(getPriorityFee(input.options))({
                      programId,
                      buffer,
                      seed: input.options.seed ?? IDL_SEED,
                      closeBuffer: input.options["close-buffer"] === true,
                      connection,
                      wallet,
                    })
                  );
                  await PgTerminal.println(
                    PgTerminal.success(
                      "Metadata written successfully using buffer."
                    )
                  );
                }
              );
            }),
        }),
      ],
    }),

    // Anchor's group, declared without its subcommands so that every `anchor legacy-idl` line gets the not-supported line
    unsupportedSubcmdFor("anchor")(
      "legacy-idl",
      "[DEPRECATED] Manage legacy on-chain IDL accounts"
    ),
  ],
});
