import type { OrString } from "../types";
import { PgWeb3 } from "../web3";
import type {
  GeneratableInstruction,
  InstructionValueGenerator,
} from "./generator";
import { getPrograms } from "./generators";
import { getIdlType, Idl, IdlAccount, IdlInstruction } from "./idl-types";

/**
 * Create a generatable instruction from the given IDL instruction.
 *
 * @param idlIx IDL instruction
 * @returns the generatable instruction
 */
export const createGeneratableInstruction = (
  idlIx: IdlInstruction
): GeneratableInstruction => {
  return {
    name: idlIx.name,
    values: {
      programId: { generator: { type: "Current program" } },
      // TODO: Handle composite accounts?
      accounts: (idlIx.accounts as IdlAccount[]).map((acc) => ({
        ...acc,
        generator: createAccountGenerator(acc),
      })),
      args: idlIx.args.map((arg) => ({
        ...arg,
        generator: { type: "Custom", value: "" },
      })),
    },
  };
};

/**
 * Fill empty values of the given generatable instruction with "Random"
 * generators.
 *
 * @param ix generatable instruction
 * @param idl IDL
 * @returns the instruction with empty values filled with "Random" generator
 */
export const fillRandom = (
  ix: GeneratableInstruction,
  idl: Idl
): GeneratableInstruction => ({
  ...ix,
  values: {
    ...ix.values,
    accounts: ix.values.accounts.map((acc) => {
      // Only override empty fields
      if (acc.generator.type === "Custom" && !acc.generator.value) {
        return {
          ...acc,
          generator: {
            type: "Random",
            data: Array.from(PgWeb3.Keypair.generate().secretKey),
            get value() {
              return PgWeb3.Keypair.fromSecretKey(
                Uint8Array.from((this as { data: number[] }).data)
              ).publicKey.toBase58();
            },
          },
        };
      }

      return acc;
    }),
    args: ix.values.args.map((arg) => {
      // Only override empty fields
      if (arg.generator.type === "Custom" && !arg.generator.value) {
        return {
          ...arg,
          generator: {
            type: "Random",
            value: getIdlType(arg.type, idl).generateRandom(),
          },
        };
      }

      return arg;
    }),
  },
});

/**
 * Create an account generator from the given IDL account.
 *
 * @param acc IDL account
 * @returns the account generator
 */
const createAccountGenerator = (acc: IdlAccount): InstructionValueGenerator => {
  // Handle `seeds` feature
  // TODO: Re-evaluate this once Anchor package has proper types for PDA seeds
  // https://github.com/coral-xyz/anchor/issues/2750
  if (acc.pda) {
    return {
      type: "From seed",
      seeds: acc.pda.seeds.map((seed) => ({
        type: seed.type,
        generator: seedGenerator(seed),
      })),
      programId: {
        generator: acc.pda.programId
          ? seedGenerator(acc.pda.programId)
          : { type: "Current program" },
      },
    };
  }

  // An account the IDL fixes (`address`, e.g. a program); a PDA above wins,
  // since its seeds name the address, and the guesses below are only guesses
  const address = (acc as IdlAccount & { address?: string }).address;
  if (address) return { type: "Custom", value: address };

  // Set common wallet account names to current wallet
  const COMMON_WALLET_ACCOUNT_NAMES = ["authority", "owner", "payer", "signer"];
  if (acc.isSigner && COMMON_WALLET_ACCOUNT_NAMES.includes(acc.name)) {
    return { type: "Current wallet" };
  }

  // Check whether it's a known program
  const knownProgram = getPrograms().find((p) => p.alias?.includes(acc.name));
  if (knownProgram) return { type: "All programs", name: knownProgram.name };

  return { type: "Custom", value: getKnownAccountKey(acc.name) ?? "" };
};

/** What a seed of its kind must carry, or a throw naming what is missing */
const seedField = (
  seed: { kind: string; value?: string; path?: string },
  field: "value" | "path"
) => {
  const value = seed[field];
  if (value === undefined)
    throw new Error(`Seed of kind \`${seed.kind}\` has no \`${field}\``);
  return value;
};

/**
 * The generator that fills one PDA seed (or the seed program) of an IDL.
 * The 0.29 package types seeds as `any`; a `const` seed carries `value`, an
 * `arg` or `account` seed carries `path`.
 *
 * @param seed IDL seed: a constant, or an argument or account by name
 */
const seedGenerator = (seed: {
  kind: string;
  value?: string;
  path?: string;
}):
  | { type: "Custom"; value: string }
  | { type: "Arguments" | "Accounts"; name: string } => {
  switch (seed.kind) {
    case "const":
      return { type: "Custom", value: seedField(seed, "value") };
    case "arg":
      return { type: "Arguments", name: seedField(seed, "path") };
    case "account":
      return { type: "Accounts", name: seedField(seed, "path") };
    default:
      throw new Error(`Unknown seed kind: \`${seed.kind}\``);
  }
};

/**
 * Get the public key of known accounts, e.g. `systemProgram`.
 *
 * @param name name of the account
 * @returns account public key as string or empty string if the name is unknown
 */
const getKnownAccountKey = <
  T extends typeof KNOWN_ACCOUNT_KEYS,
  N extends OrString<keyof T>
>(
  name: N
) => {
  return (KNOWN_ACCOUNT_KEYS[name as keyof typeof KNOWN_ACCOUNT_KEYS] ??
    null) as N extends keyof T ? T[N] : string | null;
};

/* Known account name -> account key map */
// TODO: Add sysvar generator
const KNOWN_ACCOUNT_KEYS = {
  clock: PgWeb3.SYSVAR_CLOCK_PUBKEY.toBase58(),
  rent: PgWeb3.SYSVAR_RENT_PUBKEY.toBase58(),
} as const;
