import {
  AccountRole,
  type AccountSignerMeta,
  type Address,
  address,
  createAddressWithSeed,
  createSolanaRpc,
  fetchEncodedAccount,
  getAddressDecoder,
  getProgramDerivedAddress,
  getStructEncoder,
  getU8Encoder,
  getU32Decoder,
  getU64Encoder,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { inflate } from "pako";

import { trackCommandFor } from "./commands";
import { IdlCommandRefusedError } from "./refusal";
import { type IdlSendDeps, sendPlanWith } from "./send";

/**
 * The seed `IdlAccount::address` of Anchor's `anchor-lang` derives the Anchor IDL account with.
 * @see https://github.com/solana-foundation/anchor/blob/v1.1.2/lang/src/idl.rs
 */
const LEGACY_IDL_SEED = "anchor:idl";

/** `IDL_IX_TAG` of `anchor-lang`: the first 8 bytes of every legacy IDL instruction, little-endian */
const IDL_IX_TAG = 0x0a69e9a778bcf440n;

/** The Borsh variant index of `IdlInstruction::Close` */
const IDL_CLOSE_VARIANT = 5;

/** `IdlAccount::DISCRIMINATOR`: the first 8 bytes of SHA-256 of `internal:IdlAccount` */
const IDL_ACCOUNT_DISCRIMINATOR = [24, 70, 98, 191, 58, 144, 123, 158];

/** The bytes of an `IdlAccount` before its compressed IDL: discriminator, authority, and the u32 length */
const IDL_HEADER_LENGTH = 44;

/** `ERASED_AUTHORITY` of `anchor-lang`, which no wallet can sign for */
const ERASED_AUTHORITY = "11111111111111111111111111111111";

/** The Anchor IDL account of `program`, as `IdlAccount::address` derives it */
const findLegacyIdlAddress = async (program: Address) => {
  const [baseAddress] = await getProgramDerivedAddress({
    programAddress: program,
    seeds: [],
  });
  return createAddressWithSeed({
    baseAddress,
    programAddress: program,
    seed: LEGACY_IDL_SEED,
  });
};

type Rpc = ReturnType<typeof createSolanaRpc>;

type LegacyIdlAccount = NonNullable<
  Awaited<ReturnType<typeof fetchLegacyIdlAccountAt>>
>;

/** The owner, authority, and data of the Anchor IDL account at `at`; `undefined` when the address holds no account with its discriminator */
const fetchLegacyIdlAccountAt = async (rpc: Rpc, at: Address) => {
  const account = await fetchEncodedAccount(rpc, at);
  if (
    !account.exists ||
    account.data.length < IDL_HEADER_LENGTH ||
    IDL_ACCOUNT_DISCRIMINATOR.some((byte, i) => account.data[i] !== byte)
  ) {
    return undefined;
  }
  return {
    address: at,
    owner: account.programAddress,
    authority: getAddressDecoder().decode(
      account.data,
      IDL_ACCOUNT_DISCRIMINATOR.length
    ),
    data: Uint8Array.from(account.data),
  };
};

/**
 * The Anchor IDL account `target` names, as `fetch_idl` of Anchor 1.1.2's CLI
 * resolves it: an executable account is a program, whose account is derived;
 * any other address, an IDL buffer's included, is read as the account itself.
 * Throws an {@link IdlCommandRefusedError} when there is none.
 */
const fetchNamedLegacyIdlAccount = async (rpc: Rpc, target: Address) => {
  const named = await fetchEncodedAccount(rpc, target);
  const isProgram = named.exists && named.executable;
  const account = await fetchLegacyIdlAccountAt(
    rpc,
    isProgram ? await findLegacyIdlAddress(target) : target
  );
  if (!account) {
    throw new IdlCommandRefusedError(
      "not_found",
      isProgram
        ? `Program ${target} has no legacy IDL on the selected network.`
        : `No legacy IDL account exists at ${target} on the selected network.`
    );
  }
  return account;
};

/** Sorts every object's keys, as `serde_json::Value` holds them without its `preserve_order` feature, which Anchor 1.1.2's lockfile leaves off */
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])])
  );
};

/**
 * The IDL in the data of the Anchor IDL account at `at`, printed as
 * `serde_json::to_string_pretty` prints it. Throws an {@link IdlCommandRefusedError}
 * for data that holds no complete IDL, such as an unfinished buffer's.
 */
const getLegacyIdlJson = ({ address: at, data }: LegacyIdlAccount) => {
  const incomplete = (cause: unknown) => {
    const error = new IdlCommandRefusedError(
      "invalid",
      `The legacy IDL account at ${at} does not hold a complete IDL.`
    );
    error.cause = cause;
    return error;
  };
  const length = getU32Decoder().decode(data, IDL_HEADER_LENGTH - 4);
  // The stored length is the writer's claim, which an unfinished buffer makes before its data is written
  if (IDL_HEADER_LENGTH + length > data.length) {
    throw incomplete(
      new Error(
        `The account holds ${
          data.length - IDL_HEADER_LENGTH
        } bytes of a ${length}-byte IDL`
      )
    );
  }
  let idl: unknown;
  try {
    idl = JSON.parse(
      inflate(data.subarray(IDL_HEADER_LENGTH, IDL_HEADER_LENGTH + length), {
        to: "string",
      })
    );
  } catch (error) {
    throw incomplete(error);
  }
  return JSON.stringify(sortKeys(idl), undefined, 2);
};

/** What `anchor legacy-idl fetch` takes from its caller */
interface LegacyIdlFetch {
  /** Base58: a program id, or an Anchor IDL account or buffer */
  target: string;
  /** Its `rpcEndpoint` also names the events' `cluster` */
  connection: Pick<IdlSendDeps["connection"], "rpcEndpoint">;
}

/**
 * `anchor legacy-idl fetch`: the IDL of an Anchor IDL account, with the
 * subcommand's events. Throws an {@link IdlCommandRefusedError} when there is none.
 */
export const fetchLegacyIdl = trackCommandFor("legacy-fetch")(
  async ({ target, connection }: LegacyIdlFetch) => {
    return getLegacyIdlJson(
      await fetchNamedLegacyIdlAccount(
        createSolanaRpc(connection.rpcEndpoint),
        address(target)
      )
    );
  }
);

/** What `anchor legacy-idl close` takes from its caller */
interface LegacyIdlClose extends IdlSendDeps {
  /** Base58 */
  programId: string;
  /** Base58; `undefined` closes the account derived from the program */
  idlAddress: string | undefined;
}

/** `IdlInstruction::Close` of `program`, which sends `account`'s rent to `authority` */
const getLegacyIdlCloseInstruction = (
  program: Address,
  { account, authority }: { account: Address; authority: TransactionSigner }
): Instruction => {
  const signerMeta: AccountSignerMeta = {
    address: authority.address,
    role: AccountRole.READONLY_SIGNER,
    signer: authority,
  };
  return {
    programAddress: program,
    accounts: [
      { address: account, role: AccountRole.WRITABLE },
      signerMeta,
      // `sol_destination` of Anchor's `IdlCloseAccount`: the wallet, as Anchor 1.1.2's CLI sends it
      { address: authority.address, role: AccountRole.WRITABLE },
    ],
    data: getStructEncoder([
      ["tag", getU64Encoder()],
      ["variant", getU8Encoder()],
    ]).encode({ tag: IDL_IX_TAG, variant: IDL_CLOSE_VARIANT }),
  };
};

/**
 * `anchor legacy-idl close`: closes a program's Anchor IDL account through the
 * program's own IDL instruction and sends its rent to the wallet, with the
 * subcommand's events. Throws an {@link IdlCommandRefusedError} while nothing was sent.
 */
export const closeLegacyIdlAccountWith = (priorityFee: bigint) =>
  trackCommandFor("legacy-close")(
    async ({ programId, idlAddress, connection, wallet }: LegacyIdlClose) => {
      const rpc = createSolanaRpc(connection.rpcEndpoint);
      const program = address(programId);
      const at = idlAddress
        ? address(idlAddress)
        : await findLegacyIdlAddress(program);
      const account = await fetchLegacyIdlAccountAt(rpc, at);
      // The program closes only an account it owns, so another owner's is no IDL account of it
      if (!account || account.owner !== program) {
        throw new IdlCommandRefusedError(
          "not_found",
          idlAddress
            ? `No legacy IDL account of program ${programId} exists at ${idlAddress} on the selected network.`
            : `Program ${programId} has no legacy IDL on the selected network.`
        );
      }
      if (account.authority === ERASED_AUTHORITY) {
        throw new IdlCommandRefusedError(
          "authority",
          "The legacy IDL account has no authority, so no wallet can close it."
        );
      }
      if (account.authority !== address(wallet.publicKey.toBase58())) {
        throw new IdlCommandRefusedError(
          "authority",
          `The legacy IDL account's authority is ${account.authority}. Connect that wallet to close it.`
        );
      }

      await sendPlanWith(priorityFee)(
        { connection, wallet },
        {
          name: "legacy IDL close",
          toPlan: ({ signer }) =>
            getLegacyIdlCloseInstruction(program, {
              account: at,
              authority: signer,
            }),
        }
      );
      return { closed: at };
    }
  );

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;

  describe("features/program-idl/model/legacy", () => {
    const AT = address("SysvarRent111111111111111111111111111111111");
    const IDL = { version: "0.1.0", name: "counter", instructions: [] };

    let deflate: typeof import("pako").deflate;

    beforeAll(async () => {
      ({ deflate } = await import("pako"));
    });

    /** An Anchor IDL account whose header claims `length` bytes and whose data after the header is `idl` */
    const accountOf = (length: number, idl: Uint8Array): LegacyIdlAccount => {
      const data = new Uint8Array(IDL_HEADER_LENGTH + idl.length);
      data.set(IDL_ACCOUNT_DISCRIMINATOR);
      new DataView(data.buffer).setUint32(IDL_HEADER_LENGTH - 4, length, true);
      data.set(idl, IDL_HEADER_LENGTH);
      return { address: AT, owner: AT, authority: AT, data };
    };

    it.each([
      {
        // Without the length check, the complete stream before the claimed end would print as the IDL
        label:
          "a stored length past the data, though the data holds a whole IDL",
        account: () => {
          const idl = deflate(JSON.stringify(IDL));
          return accountOf(idl.length + 1, idl);
        },
      },
      {
        // Without the catch, the line would be pako's own message
        label: "bytes that do not inflate",
        account: () => accountOf(4, Uint8Array.from([1, 2, 3, 4])),
      },
    ])("getLegacyIdlJson refuses $label as incomplete", ({ account }) => {
      expect(() => getLegacyIdlJson(account())).toThrow(
        `The legacy IDL account at ${AT} does not hold a complete IDL.`
      );
    });
  });
}
