import {
  AccountRole,
  type Address,
  address as toAddress,
  appendTransactionMessageInstruction,
  type Base58EncodedBytes,
  type Base64EncodedWireTransaction,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getBase64Decoder,
  getBase64Encoder,
  getTransactionEncoder,
  type Instruction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

import { toBytes } from "./bytes";
import type { SolanaClient } from "./client";
import { buildBalanceMessage } from "./lamports";
import { formatTransactionError } from "./transaction-error";

const UPGRADEABLE_LOADER = toAddress(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

/** The loader's `UpgradeableLoaderState::Buffer` variant, a little-endian `u32` */
const BUFFER_VARIANT = new Uint8Array([1, 0, 0, 0]);

/** Size of the variant, of the `Option` tag and of an address: what the buffer's header spans */
const VARIANT_SIZE = 4;
const OPTION_SIZE = 1;
const ADDRESS_SIZE = 32;

/** The loader's `Close` instruction: variant 5 as a little-endian `u32` */
const CLOSE_INSTRUCTION_DATA = new Uint8Array([5, 0, 0, 0]);

/** The pause between two looks at a sent transaction's status, in milliseconds */
const POLL_INTERVAL_MS = 500;

/** The levels of confirmation, weakest first */
const COMMITMENTS = ["processed", "confirmed", "finalized"];

/** A buffer whose authority is the wallet, as the buffers table lists it */
export interface Buffer {
  readonly address: string;
  readonly authority: string;
  readonly lamports: bigint;
}

/** What closing buffers needs of the wallet: its address and a signature over a transaction's wire bytes */
export interface BufferCloser {
  readonly address: string;
  sign(wireTransaction: Uint8Array): Promise<Uint8Array>;
}

/** What `program close --buffers` did: the buffers it closed and, for each other, why it did not */
export interface CloseResult {
  readonly closed: readonly Buffer[];
  readonly skipped: readonly {
    readonly buffer: Buffer;
    readonly reason: string;
  }[];
}

/** The header `program show --buffers` prints above its rows: a blank line, then the column names padded to the address width */
const TABLE_HEADER = `\n${"Buffer Address".padEnd(44)} | ${"Authority".padEnd(
  44
)} | Balance\n`;

/**
 * The table the Solana CLI prints for buffers, which `buffers-table.ts` lays
 * out for the terminal's width.
 *
 * @param buffers the rows
 * @returns the table's text, ending in a newline
 */
export const formatBuffersTable = (buffers: readonly Buffer[]) =>
  TABLE_HEADER +
  buffers
    .map(
      (buffer) =>
        `${buffer.address.padEnd(44)} | ${buffer.authority.padEnd(
          44
        )} | ${buildBalanceMessage(buffer.lamports)}\n`
    )
    .join("");

/**
 * The buffers a wallet is the authority of, found with the Solana CLI's
 * `getProgramAccounts` filters.
 *
 * @param client the cluster to read
 * @returns a function from the authority's address to its buffers
 * @throws {Error} when the cluster cannot be read or an account is not a buffer
 */
export const fetchBuffersWith =
  (client: SolanaClient) => async (authority: string) => {
    const base58 = getBase58Decoder();
    const memcmp = (offset: bigint, bytes: string) => ({
      memcmp: {
        offset,
        bytes: bytes as Base58EncodedBytes,
        encoding: "base58" as const,
      },
    });

    const accounts = await client.rpc
      .getProgramAccounts(UPGRADEABLE_LOADER, {
        commitment: client.commitment,
        dataSlice: {
          offset: 0,
          length: VARIANT_SIZE + OPTION_SIZE + ADDRESS_SIZE,
        },
        encoding: "base64",
        filters: [
          memcmp(0n, base58.decode(BUFFER_VARIANT)),
          memcmp(BigInt(VARIANT_SIZE), base58.decode(new Uint8Array([1]))),
          memcmp(BigInt(VARIANT_SIZE + OPTION_SIZE), authority),
        ],
      })
      .send();

    return accounts.map(({ pubkey, account }): Buffer => {
      const data = toBytes(getBase64Encoder().encode(account.data[0]));
      const isBuffer =
        data.length >= VARIANT_SIZE + OPTION_SIZE + ADDRESS_SIZE &&
        BUFFER_VARIANT.every((byte, i) => data[i] === byte) &&
        data[VARIANT_SIZE] === 1;
      if (!isBuffer) throw new Error(`Error parsing Buffer account ${pubkey}`);

      return {
        address: pubkey,
        authority: base58.decode(
          data.slice(
            VARIANT_SIZE + OPTION_SIZE,
            VARIANT_SIZE + OPTION_SIZE + ADDRESS_SIZE
          )
        ),
        lamports: account.lamports,
      };
    });
  };

/** The loader's `Close` for a buffer, sending its lamports to the wallet that is also its authority */
const closeInstructionFor =
  (wallet: Address) =>
  (buffer: string): Instruction => ({
    programAddress: UPGRADEABLE_LOADER,
    accounts: [
      { address: toAddress(buffer), role: AccountRole.WRITABLE },
      { address: wallet, role: AccountRole.WRITABLE },
      { address: wallet, role: AccountRole.READONLY_SIGNER },
    ],
    data: CLOSE_INSTRUCTION_DATA,
  });

/**
 * Close a buffer and wait for the cluster to confirm it, as the Solana CLI's
 * `close` did: one transaction, sent without preflight, its status polled.
 *
 * @throws {Error} when the transaction fails or expires, or the cluster cannot be asked
 */
const closeBufferWith =
  (client: SolanaClient) =>
  (closer: BufferCloser) =>
  (wait: (ms: number) => Promise<void>) =>
  async (buffer: string) => {
    const wallet = toAddress(closer.address);
    const { value: lifetime } = await client.rpc
      .getLatestBlockhash({ commitment: client.commitment })
      .send();

    const message = pipe(
      createTransactionMessage({ version: "legacy" }),
      (m) => setTransactionMessageFeePayer(wallet, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
      (m) =>
        appendTransactionMessageInstruction(
          closeInstructionFor(wallet)(buffer),
          m
        )
    );
    const unsigned = getTransactionEncoder().encode(
      compileTransaction(message)
    );
    const signed = await closer.sign(Uint8Array.from(toBytes(unsigned)));

    const signature = await client.rpc
      .sendTransaction(
        getBase64Decoder().decode(signed) as Base64EncodedWireTransaction,
        {
          encoding: "base64",
          skipPreflight: true,
          preflightCommitment: client.commitment,
        }
      )
      .send();

    const wanted = COMMITMENTS.indexOf(client.commitment);
    for (;;) {
      const { value } = await client.rpc
        .getSignatureStatuses([signature])
        .send();
      const status = value[0];
      if (status?.err) throw new Error(formatTransactionError(status.err));
      if (
        status?.confirmationStatus &&
        COMMITMENTS.indexOf(status.confirmationStatus) >= wanted
      ) {
        return;
      }

      const height = await client.rpc
        .getBlockHeight({ commitment: client.commitment })
        .send();
      if (height > lifetime.lastValidBlockHeight) {
        throw new Error("transaction expired before it was confirmed");
      }
      await wait(POLL_INTERVAL_MS);
    }
  };

/**
 * `program close --buffers`: close every buffer the wallet is the authority
 * of, one transaction each. A buffer whose close fails is skipped with its
 * reason, and the rest still close.
 *
 * @param client the cluster to close them on
 * @returns a function from the wallet to what it did
 * @throws {Error} when the buffers cannot be listed
 */
export const closeBuffersWith =
  (client: SolanaClient) =>
  (wait: (ms: number) => Promise<void>) =>
  async (closer: BufferCloser): Promise<CloseResult> => {
    const buffers = await fetchBuffersWith(client)(closer.address);
    const close = closeBufferWith(client)(closer)(wait);

    const closed: Buffer[] = [];
    const skipped: { buffer: Buffer; reason: string }[] = [];
    for (const buffer of buffers) {
      try {
        await close(buffer.address);
        closed.push(buffer);
      } catch (e) {
        skipped.push({
          buffer,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return { closed, skipped };
  };
