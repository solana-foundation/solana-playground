import {
  type Address,
  getBase58Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";

import { toBytes } from "./bytes";
import { displaySol, formatSol } from "./lamports";
import { formatTransactionError } from "./transaction-error";

/** Indent of every line of the transaction, as `CliTransaction.prefix` of `solana confirm` */
const PREFIX = "  ";

const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";

/**
 * Addresses `is_builtin_key_or_sysvar` of solana-program 1.18 demotes to
 * read-only: `BUILTIN_PROGRAMS_KEYS` and the ids of `sysvar::ALL_IDS`.
 */
const BUILTIN_OR_SYSVAR = new Set<string>([
  "Config1111111111111111111111111111111111111",
  "Feature111111111111111111111111111111111111",
  "NativeLoader1111111111111111111111111111111",
  "Stake11111111111111111111111111111111111111",
  "StakeConfig11111111111111111111111111111111",
  "Vote111111111111111111111111111111111111111",
  "11111111111111111111111111111111",
  "BPFLoader2111111111111111111111111111111111",
  "BPFLoader1111111111111111111111111111111111",
  UPGRADEABLE_LOADER,
  "SysvarC1ock11111111111111111111111111111111",
  "SysvarEpochSchedu1e111111111111111111111111",
  "SysvarFees111111111111111111111111111111111",
  "SysvarRecentB1ockHashes11111111111111111111",
  "SysvarRent111111111111111111111111111111111",
  "SysvarRewards111111111111111111111111111111",
  "SysvarS1otHashes111111111111111111111111111",
  "SysvarS1otHistory11111111111111111111111111",
  "SysvarStakeHistory1111111111111111111111111",
  "Sysvar1nstructions1111111111111111111111111",
]);

/** The reward kinds a `getTransaction` response names, as Rust's `RewardType` `Debug` prints them */
const REWARD_TYPES: Record<string, string> = {
  fee: "Fee",
  rent: "Rent",
  staking: "Staking",
  voting: "Voting",
};

/** A number that kit's transport may hand over as a `bigint` */
type Integer = number | bigint;

/** What `solana confirm -v` reads of `getTransaction`'s `meta` */
export interface TransactionMeta {
  /** The transaction's error; absent when it did not fail */
  readonly err?: unknown;
  readonly fee: Integer;
  readonly preBalances: readonly Integer[];
  readonly postBalances: readonly Integer[];
  readonly logMessages?: readonly string[];
  readonly returnData?: {
    readonly programId: string;
    readonly data: readonly [string, string];
  };
  readonly rewards?: readonly {
    readonly pubkey: string;
    readonly lamports: Integer;
    readonly postBalance: Integer;
    readonly rewardType?: string;
  }[];
}

/** What `solana confirm -v` reads of a `getTransaction` response (`encoding: "base64"`) */
export interface TransactionDetails {
  readonly slot: Integer;
  readonly blockTime?: Integer;
  /** The wire transaction, base64 */
  readonly transaction: string;
  readonly meta?: TransactionMeta;
}

/** Rust's `{:?}` of a `Vec<u8>` */
const formatBytes = (bytes: ArrayLike<number>) =>
  `[${Array.from(bytes).join(", ")}]`;

/** Rust's `{:<width}` of a string */
const padEnd = (width: number) => (text: string) => text.padEnd(width);

/** Rust's `{:^width}` of a string: the odd space goes to the right */
const center = (width: number) => (text: string) => {
  const space = Math.max(width - text.length, 0);
  const left = Math.floor(space / 2);
  return " ".repeat(left) + text + " ".repeat(space - left);
};

/** Rust's `{:02x}` */
const hex2 = (byte: number) => byte.toString(16).padStart(2, "0");

/**
 * `pretty_hex`'s default dump, which `Return Data from Program` prints: a
 * title with the length, then rows of 16 bytes in groups of 4 with their
 * ASCII beside them.
 */
export const hexDump = (bytes: readonly number[]) => {
  const lines = [
    `Length: ${bytes.length} (0x${bytes.length.toString(16)}) bytes`,
  ];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const row = bytes.slice(offset, offset + 16);
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 4) {
      groups.push(
        Array.from({ length: 4 }, (_, j) =>
          i + j < row.length ? hex2(row[i + j]) : "  "
        ).join(" ")
      );
    }
    const ascii = row
      .map((byte) =>
        byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : "."
      )
      .join("");
    lines.push(
      `${offset.toString(16).padStart(4, "0")}:   ${groups.join(
        "  "
      )}   ${ascii}`
    );
  }
  return lines.join("\n");
};

/**
 * Rust's `format!("{:?}", Local.timestamp_opt(secs, 0))`: RFC 3339 with the
 * offset of the local time zone, `+00:00` for UTC.
 *
 * @param getOffsetMinutes the local zone's offset from UTC, in minutes east, at a time
 * @returns a function from Unix seconds to the date
 */
export const formatBlockTimeWith =
  (getOffsetMinutes: (date: Date) => number) => (seconds: Integer) => {
    const date = new Date(Number(seconds) * 1000);
    const offset = getOffsetMinutes(date);
    const local = new Date(date.getTime() + offset * 60_000);
    const sign = offset < 0 ? "-" : "+";
    const abs = Math.abs(offset);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return (
      local.toISOString().slice(0, 19) +
      `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
    );
  };

/** The local zone's offset east of UTC, in minutes, at a date */
const getLocalOffsetMinutes = (date: Date) => -date.getTimezoneOffset();

/**
 * The transaction as the Solana CLI's `println_transaction` prints it, for
 * `solana confirm -v` (slot header and all, with the status that follows
 * left to the caller).
 *
 * @param formatBlockTime formats a block time in the zone the output is for
 * @returns a function from the transaction's details to the text, ending in a newline
 */
export const printTransactionWith =
  (formatBlockTime: (seconds: Integer) => string) =>
  (details: TransactionDetails) => {
    const bytes = toBytes(getBase64Encoder().encode(details.transaction));
    const transaction = getTransactionDecoder().decode(bytes);
    const message = getCompiledTransactionMessageDecoder().decode(
      transaction.messageBytes
    );
    // Version 1 is newer than the Solana 1.18 CLI this reproduces
    if (message.version === 1) {
      throw new Error("Transaction version 1 is not supported");
    }
    const { header, staticAccounts, instructions } = message;
    const lookups =
      message.version === 0 ? message.addressTableLookups ?? [] : [];

    const lines: string[] = [];
    const line = (text: string) => lines.push(PREFIX + text);

    lines.push(`\nTransaction executed in slot ${details.slot}:`);
    if (details.blockTime !== undefined) {
      line(`Block Time: ${formatBlockTime(details.blockTime)}`);
    }
    line(
      `Version: ${message.version === "legacy" ? "legacy" : message.version}`
    );
    line(`Recent Blockhash: ${message.lifetimeToken}`);
    const base58 = getBase58Decoder();
    Object.values(transaction.signatures).forEach((signature, i) => {
      line(`Signature ${i}: ${signature ? base58.decode(signature) : ""}`);
    });

    // Addresses a lookup table supplies are unknown here, so they are
    // named by the lookup that loads them: writable ones first, then
    // read-only, as the runtime orders them
    const dynamicKeys = [
      ...lookups.flatMap((lookup, lookupIndex) =>
        lookup.writableIndexes.map(
          (tableIndex) =>
            `Unknown Address (uses lookup ${lookupIndex} and index ${tableIndex})`
        )
      ),
      ...lookups.flatMap((lookup, lookupIndex) =>
        lookup.readonlyIndexes.map(
          (tableIndex) =>
            `Unknown Address (uses lookup ${lookupIndex} and index ${tableIndex})`
        )
      ),
    ];
    const accountKeys: string[] = [...staticAccounts, ...dynamicKeys];
    const writableDynamicCount = lookups.reduce(
      (count, lookup) => count + lookup.writableIndexes.length,
      0
    );

    const isInvoked = (index: number) =>
      instructions.some((ix) => ix.programAddressIndex === index);
    const isPassedToProgram = (index: number) =>
      instructions.some((ix) => ix.accountIndices?.includes(index));
    const hasUpgradeableLoader = staticAccounts.includes(
      UPGRADEABLE_LOADER as Address
    );
    const signers = header.numSignerAccounts;
    const isWritableIndex = (index: number) => {
      if (index >= staticAccounts.length) {
        return index - staticAccounts.length < writableDynamicCount;
      }
      if (index >= signers) {
        const unsigned = staticAccounts.length - signers;
        return index - signers < unsigned - header.numReadonlyNonSignerAccounts;
      }
      return index < signers - header.numReadonlySignerAccounts;
    };
    // A static key the runtime demotes to read-only: a builtin, a sysvar, or
    // a program called by an instruction when no upgradeable loader is among the keys
    const isDemoted = (index: number) =>
      BUILTIN_OR_SYSVAR.has(staticAccounts[index] ?? "") ||
      (isInvoked(index) && !hasUpgradeableLoader);
    const isMaybeWritable = (index: number) =>
      isWritableIndex(index) && !isDemoted(index);

    const feePayerIndex = accountKeys.findIndex(
      (_, index) => !isInvoked(index) || isPassedToProgram(index)
    );
    accountKeys.forEach((address, index) => {
      const mode = `${index < signers ? "s" : "-"}r${
        isMaybeWritable(index) ? "w" : "-"
      }${isInvoked(index) ? "x" : "-"}`;
      line(
        `Account ${index}: ${mode} ${address}${
          index === feePayerIndex ? " (fee payer)" : ""
        }`
      );
    });

    instructions.forEach((instruction, index) => {
      line(`Instruction ${index}`);
      line(
        `  Program:   ${accountKeys[instruction.programAddressIndex]} (${
          instruction.programAddressIndex
        })`
      );
      (instruction.accountIndices ?? []).forEach((accountIndex, i) => {
        line(`  Account ${i}: ${accountKeys[accountIndex]} (${accountIndex})`);
      });
      line(
        `  Data: ${formatBytes(toBytes(instruction.data ?? new Uint8Array()))}`
      );
    });

    lookups.forEach((lookup, index) => {
      line(`Address Table Lookup ${index}`);
      line(`  Table Account: ${lookup.lookupTableAddress}`);
      line(`  Writable Indexes: ${formatBytes(lookup.writableIndexes)}`);
      line(`  Readonly Indexes: ${formatBytes(lookup.readonlyIndexes)}`);
    });

    const { meta } = details;
    if (!meta) {
      line("Status: Unavailable");
    } else {
      line(
        `Status: ${
          meta.err === undefined ? "Ok" : formatTransactionError(meta.err)
        }`
      );
      line(`  Fee: ◎${displaySol(BigInt(meta.fee))}`);
      meta.preBalances.forEach((pre, index) => {
        const post = meta.postBalances[index];
        const before = displaySol(BigInt(pre));
        line(
          BigInt(pre) === BigInt(post)
            ? `  Account ${index} balance: ◎${before}`
            : `  Account ${index} balance: ◎${before} -> ◎${displaySol(
                BigInt(post)
              )}`
        );
      });
      if (meta.logMessages?.length) {
        line("Log Messages:");
        for (const log of meta.logMessages) line(`  ${log}`);
      }
      if (meta.returnData) {
        const data = getBase64Encoder().encode(meta.returnData.data[0]);
        if (data.length) {
          line(`Return Data from Program ${meta.returnData.programId}:`);
          line(`  ${JSON.stringify(hexDump(Array.from(toBytes(data))))}`);
        }
      }
      if (meta.rewards?.length) {
        line("Rewards:");
        line(
          `  ${padEnd(44)("Address")}  ${center(15)("Type")}  ${padEnd(16)(
            "Amount"
          )}  ${padEnd(20)("New Balance")}`
        );
        for (const reward of meta.rewards) {
          const lamports = BigInt(reward.lamports);
          const sign = lamports < 0n ? "-" : "";
          const abs = lamports < 0n ? -lamports : lamports;
          const type = reward.rewardType
            ? REWARD_TYPES[reward.rewardType] ?? reward.rewardType
            : "-";
          line(
            `  ${padEnd(44)(reward.pubkey)}  ${center(15)(
              type
            )}  ${sign}◎${padEnd(14)(formatSol(abs))}  ◎${padEnd(18)(
              formatSol(BigInt(reward.postBalance))
            )}`
          );
        }
      }
    }

    return lines.join("\n") + "\n";
  };

/** {@link printTransactionWith} for the browser's time zone */
export const printTransaction = printTransactionWith(
  formatBlockTimeWith(getLocalOffsetMinutes)
);
