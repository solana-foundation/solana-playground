import { isAddress } from "@solana/kit";

import {
  IdlUploadRefusedError,
  uploadProjectIdl,
} from "@/features/program-idl";

import {
  PgConnection,
  PgGlobal,
  PgProgramInfo,
  PgTerminal,
  PgWallet,
  TerminalLineError,
} from "../../utils";
import { checkWallet } from "../checks";
import { createArgs, createCmd, createSubcmd } from "../create";
import { refuseMainnetWith } from "../deploy/check-not-mainnet";
import { IDL_NETWORK_CHANGED, IDL_REFUSAL } from "../deploy/mainnet-block";

const refuseIdlWriteOnMainnet = refuseMainnetWith(IDL_REFUSAL);

/** The `anchor idl` subcommands of Anchor's CLI that act on the legacy IDL account, which an Anchor 1.1.2 program does not serve */
const UNSUPPORTED_IDL_SUBCOMMANDS = [
  "authority",
  "close",
  "erase-authority",
  "fetch",
  "set-authority",
  "set-buffer",
  "write-buffer",
] as const;

const programIdArg = {
  name: "program_id",
  description: "Program to write the IDL for (default: the project's program)",
  optional: true,
  parse: (token: string) => {
    if (isAddress(token)) return token;
    throw new Error("Program ID must be a base58 address");
  },
} as const;

/**
 * Writes the IDL the project holds to the canonical Program Metadata account
 * of `programId`, or of the project's program when `programId` is `undefined`.
 * Throws a {@link TerminalLineError} when it refuses before sending.
 */
const writeIdl = async (programId: string | undefined) => {
  const wallet = PgWallet.current;
  if (!wallet) throw new Error("No wallet is connected.");

  // Settings' `pickNetwork` refuses a switch the user asks for while this is set, so the selected network stays the one the upload writes to
  PgGlobal.isIdlWriting = true;
  try {
    const connection = PgConnection.current;
    await refuseIdlWriteOnMainnet(connection.rpcEndpoint);
    // The hold covers user switches only: after any other change the selected network is not the one that was read
    if (PgConnection.current.rpcEndpoint !== connection.rpcEndpoint) {
      throw new TerminalLineError(IDL_NETWORK_CHANGED);
    }

    const program = programId ?? PgProgramInfo.getPkStr();
    if (!program) {
      throw new TerminalLineError(
        "The project has no program ID. Build the program first, or pass a program ID."
      );
    }

    const { metadata, action } = await uploadProjectIdl({
      idl: PgProgramInfo.idl ?? undefined,
      programId: program,
      connection,
      wallet,
    });
    await PgTerminal.println(
      `${PgTerminal.success(
        `IDL ${action}.`
      )} Program Metadata account: ${metadata}`
    );
  } catch (error) {
    // A refusal's message is the whole line; thrown as it is, the terminal prints it after "Process error:"
    if (error instanceof IdlUploadRefusedError) {
      throw new TerminalLineError(error.message, { cause: error });
    }
    throw error;
  } finally {
    PgGlobal.isIdlWriting = false;
  }
};

export const anchor = createCmd({
  name: "anchor",
  description: "Anchor CLI",
  needsConnection: true,
  subcommands: [
    createSubcmd({
      name: "idl",
      description: "Commands for interacting with interface definitions",
      subcommands: [
        // `init` and `upgrade` run the same write: each creates the account or replaces the IDL it holds
        createSubcmd({
          name: "init",
          description:
            "Write the project's IDL to the program's Program Metadata account",
          args: createArgs([programIdArg]),
          preChecks: checkWallet,
          handle: (input) => writeIdl(input.args.program_id),
        }),
        createSubcmd({
          name: "upgrade",
          description:
            "Replace the on-chain IDL with the project's; the same write as init",
          args: createArgs([programIdArg]),
          preChecks: checkWallet,
          handle: (input) => writeIdl(input.args.program_id),
        }),
        ...UNSUPPORTED_IDL_SUBCOMMANDS.map((name) =>
          createSubcmd({
            name,
            description: "Not supported in the Playground terminal",
            handle: () => {
              throw new TerminalLineError(
                `\`anchor idl ${name}\` is not supported in the Playground terminal. Run Anchor's CLI on your own machine.`
              );
            },
          })
        ),
      ],
    }),
  ],
});
