import { createHash } from "node:crypto";
import type { Page, Route, WebSocketRoute } from "@playwright/test";
import {
  PublicKey,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";

import { Endpoint } from "../src/entities/cluster/model/endpoint";
import { HELLO_NAME, HELLO_WORLD } from "./fake-build-server";

/**
 * A devnet for the tutorial specs, answered in the test: the JSON-RPC calls
 * the tutorial's deploy, run and call acts make, and the websocket their
 * confirmations wait on. It keeps accounts, applies what a sent transaction
 * does to them (the system program's createAccount and transfer, the upgradeable loader's
 * buffer, deploy, upgrade and extend, a call to Hello Anchor's `hello`) and
 * writes each call's program log, so the app's own code runs end to end with
 * no network.
 *
 * Signatures are taken as sent. A transaction applies whole or not at all: one
 * that would leave a balance below zero is refused with a JSON-RPC error, as
 * the cluster's preflight refuses it; so is a write past an account's end, a
 * program bigger than the space it is given, an instruction on an account that
 * does not exist and a createAccount over one that does. `accountSubscribe`
 * hears of every change to its account. `simulateTransaction` always passes
 * and every landed signature reads finalized. A call logs only on a program the loader
 * deployed, and its log follows the bytes deployed there (`HELLO_WORLD` or
 * `HELLO_NAME`, from `fake-build-server.ts`). Anything the fake does not model
 * (a method, a program, an instruction, a subscription) fails and is listed in
 * `unhandled`, which the specs assert empty.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58, as Solana writes keys and signatures */
const bs58 = {
  encode: (bytes: Uint8Array): string => {
    let n = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
    let out = "";
    while (n > 0n) {
      out = ALPHABET[Number(n % 58n)] + out;
      n /= 58n;
    }
    for (const byte of bytes) {
      if (byte !== 0) break;
      out = `1${out}`;
    }
    return out;
  },
};

const RPC: string = Endpoint.DEVNET;
const WS = RPC.replace(/^https:/, "wss:");
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const SYSTEM = SystemProgram.programId.toBase58();
const LAMPORTS_PER_SOL = 1_000_000_000;
const FEE = 5000;
/** Bytes ahead of a buffer's program bytes: tag, Some, authority */
const BUFFER_HEADER = 37;
/** Bytes ahead of program data's bytes: tag, slot, Some, authority */
const PROGRAM_DATA_HEADER = 45;

interface Account {
  lamports: number;
  owner: string;
  data: Buffer;
  executable: boolean;
}

/** One compiled instruction, its keys resolved, landing at slot `s` */
interface Instruction {
  program: string;
  keys: string[];
  data: Buffer;
  s: number;
}

interface Landed {
  slot: number;
  blockTime: number;
  fee: number;
  logs: string[];
  accountKeys: string[];
  header: {
    numRequiredSignatures: number;
    numReadonlySignedAccounts: number;
    numReadonlyUnsignedAccounts: number;
  };
  instructions: { programIdIndex: number; accounts: number[]; data: string }[];
  recentBlockhash: string;
  preBalances: number[];
  postBalances: number[];
}

/** Anchor's instruction discriminator: the first 8 bytes of sha256 */
const discriminator = (name: string) =>
  createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

/** Something the fake does not model, listed in `unhandled` */
class Unhandled extends Error {}

/** Rent the way the runtime charges it: two years of 3480 lamports a byte-year */
const rentFor = (bytes: number) => (bytes + 128) * 6960;

export interface FakeDevnet {
  /** Whether `requestAirdrop` pays ("ok") or answers the faucet's limit */
  faucet: "ok" | "refuse";
  /**
   * Whether `getTransaction` answers a landed transaction ("ok") or not yet
   * ("lag"), as a slow devnet's index does
   */
  index: "ok" | "lag";
  /** Every JSON-RPC method the app called, in order */
  readonly calls: string[];
  /** What the app asked for that the fake does not model, in order */
  readonly unhandled: string[];
  /** The wallet's balance in SOL, or 0 for an account the fake never saw */
  balance(address: string): number;
  /** The programs the fake holds, by program id */
  programs(): string[];
}

/**
 * Routes devnet's JSON-RPC and websocket on `page` to a fresh fake chain.
 */
export const fakeDevnet = async (page: Page): Promise<FakeDevnet> => {
  // Replaced by a draft while a transaction applies; see `send`
  let accounts = new Map<string, Account>();
  const landed = new Map<string, Landed>();
  /** Signatures by the address they touched, newest last */
  const touched = new Map<string, { signature: string; slot: number }[]>();
  const calls: string[] = [];
  const unhandled: string[] = [];
  /** Notifies a `signatureSubscribe` that came before its transaction landed */
  const waiting = new Map<string, (() => void)[]>();
  /** Subscription ids, unique across every socket the page opens */
  let nextSubscription = 1;
  /** `accountSubscribe` watchers, by subscription id */
  const watchers = new Map<number, { address: string; notify: () => void }>();
  /** Tells every watcher of `keys` their account's state now */
  const changed = (keys: string[]) => {
    for (const watcher of watchers.values()) {
      if (keys.includes(watcher.address)) watcher.notify();
    }
  };
  const unknown = (what: string) => {
    unhandled.push(what);
    return new Unhandled(`the fake devnet does not model ${what}`);
  };
  const started = Date.now();
  let airdrops = 0;
  // A slot every 400 ms, as on the cluster: the app reads a slot that does
  // not move as a stalled cluster, and web3 waits for a blockhash to change
  const slot = () => 1000 + Math.floor((Date.now() - started) / 400);
  const blockhash = (s: number) =>
    bs58.encode(createHash("sha256").update(`blockhash:${s}`).digest());
  const blockTime = () => Math.floor(Date.now() / 1000);

  const fake: FakeDevnet = {
    // Read on every `requestAirdrop`, so a spec may flip it mid-run
    faucet: "ok",
    // Read on every `getTransaction`, likewise
    index: "ok",
    calls,
    unhandled,
    balance: (address) =>
      (accounts.get(address)?.lamports ?? 0) / LAMPORTS_PER_SOL,
    programs: () =>
      Array.from(accounts.entries())
        .filter(([, a]) => a.owner === LOADER && a.executable)
        .map(([key]) => key),
  };

  const account = (key: string): Account => {
    let found = accounts.get(key);
    if (!found) {
      found = {
        lamports: 0,
        owner: SYSTEM,
        data: Buffer.alloc(0),
        executable: false,
      };
      accounts.set(key, found);
    }
    return found;
  };

  /** The account at `key`, which an instruction needs to exist already */
  const existing = (key: string): Account => {
    const found = accounts.get(key);
    if (!found) throw new Error(`account ${key} does not exist`);
    return found;
  };

  /** Copies `bytes` into `into` at `at`, refusing a write past its end */
  const write = ({
    bytes,
    into,
    at,
  }: {
    bytes: Buffer;
    into: Buffer;
    at: number;
  }) => {
    if (at + bytes.length > into.length) {
      throw new Error(
        `account data too small: ${at + bytes.length} bytes into ${into.length}`
      );
    }
    bytes.copy(into, at);
  };

  /** Lists the transaction `at` under `key`, for `getSignaturesForAddress` */
  const touch = (key: string, at: { signature: string; slot: number }) => {
    const list = touched.get(key) ?? [];
    if (!list.some((t) => t.signature === at.signature)) list.push(at);
    touched.set(key, list);
  };

  /**
   * One instruction's effect at slot `s`, with its account keys resolved;
   * returns the program log lines it writes
   */
  const apply = ({ program, keys, data, s }: Instruction): string[] => {
    if (program === SYSTEM) {
      const tag = data.readUInt32LE(0);
      if (tag === 0) {
        // createAccount: lamports, space, owner
        const lamports = Number(data.readBigUInt64LE(4));
        const space = Number(data.readBigUInt64LE(12));
        const owner = new PublicKey(data.subarray(20, 52)).toBase58();
        const taken = accounts.get(keys[1]);
        if (taken && (taken.lamports > 0 || taken.data.length > 0)) {
          throw new Error(`account ${keys[1]} already in use`);
        }
        account(keys[0]).lamports -= lamports;
        accounts.set(keys[1], {
          lamports,
          owner,
          data: Buffer.alloc(space),
          executable: false,
        });
      } else if (tag === 2) {
        const lamports = Number(data.readBigUInt64LE(4));
        account(keys[0]).lamports -= lamports;
        account(keys[1]).lamports += lamports;
      } else {
        throw unknown(`system instruction ${tag}`);
      }
      return [];
    }
    if (program === LOADER) return applyLoader({ program, keys, data, s });
    if (program.startsWith("ComputeBudget")) return [];
    // A deployed program: Hello Anchor's `hello`, logged as the bytes the
    // loader holds for it would log, framed as the runtime frames it
    const target = accounts.get(program);
    if (target?.owner !== LOADER || !target.executable) {
      throw unknown(`a call to ${program}, which the loader never deployed`);
    }
    if (!discriminator("hello").equals(data.subarray(0, 8))) {
      throw unknown(`instruction ${data.subarray(0, 8).toString("hex")}`);
    }
    const programData = new PublicKey(target.data.subarray(4, 36)).toBase58();
    const code = accounts.get(programData)?.data[PROGRAM_DATA_HEADER];
    const log = helloLog(code, data.subarray(8));
    if (!log) {
      throw unknown(`a hello call on program code ${code}`);
    }
    return [
      `Program ${program} invoke [1]`,
      `Program log: Instruction: Hello`,
      `Program log: ${log}`,
      `Program ${program} consumed 1000 of 200000 compute units`,
      `Program ${program} success`,
    ];
  };

  const applyLoader = ({ keys, data, s }: Instruction): string[] => {
    const tag = data.readUInt32LE(0);
    switch (tag) {
      case 0: {
        // InitializeBuffer: [buffer, authority]
        const buffer = existing(keys[0]);
        buffer.data.writeUInt32LE(1, 0);
        buffer.data[4] = 1;
        new PublicKey(keys[1]).toBuffer().copy(buffer.data, 5);
        break;
      }
      case 1: {
        // Write: offset, then bincode bytes (u64 length first)
        const offset = data.readUInt32LE(4);
        const length = Number(data.readBigUInt64LE(8));
        write({
          bytes: data.subarray(16, 16 + length),
          into: existing(keys[0]).data,
          at: BUFFER_HEADER + offset,
        });
        break;
      }
      case 2: {
        // DeployWithMaxDataLen: [payer, programData, program, buffer, ...,
        // authority]
        const maxDataLen = Number(data.readBigUInt64LE(4));
        const [, programDataKey, programKey, bufferKey] = keys;
        const authority = keys[7];
        const buffer = existing(bufferKey);
        const bytes = buffer.data.subarray(BUFFER_HEADER);
        const programData = Buffer.alloc(PROGRAM_DATA_HEADER + maxDataLen);
        writeProgramDataHeader(programData, { slot: s, authority });
        write({ bytes, into: programData, at: PROGRAM_DATA_HEADER });
        accounts.set(programDataKey, {
          lamports: buffer.lamports,
          owner: LOADER,
          data: programData,
          executable: false,
        });
        const programAccount = existing(programKey);
        programAccount.data = Buffer.alloc(36);
        programAccount.data.writeUInt32LE(2, 0);
        new PublicKey(programDataKey).toBuffer().copy(programAccount.data, 4);
        programAccount.executable = true;
        programAccount.owner = LOADER;
        accounts.delete(bufferKey);
        break;
      }
      case 3: {
        // Upgrade: [programData, program, buffer, spill, rent, clock,
        // authority]
        const [programDataKey, , bufferKey, spillKey] = keys;
        const authority = keys[6];
        const buffer = existing(bufferKey);
        const programData = existing(programDataKey);
        const fresh = Buffer.alloc(programData.data.length);
        writeProgramDataHeader(fresh, { slot: s, authority });
        write({
          bytes: buffer.data.subarray(BUFFER_HEADER),
          into: fresh,
          at: PROGRAM_DATA_HEADER,
        });
        programData.data = fresh;
        account(spillKey).lamports += buffer.lamports;
        accounts.delete(bufferKey);
        break;
      }
      case 6: {
        // ExtendProgram: [programData, program, system, payer]
        const additional = data.readUInt32LE(4);
        const programData = existing(keys[0]);
        programData.data = Buffer.concat([
          programData.data,
          Buffer.alloc(additional),
        ]);
        break;
      }
      default:
        throw unknown(`loader instruction ${tag}`);
    }
    return [];
  };

  /**
   * Lands `wire` whole, or answers the error the cluster would and changes
   * nothing: the instructions apply to a draft of the accounts, which replaces
   * them only once every balance is still at or above zero
   */
  const send = (
    wire: string
  ): { result: string } | { error: { code: number; message: string } } => {
    const tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    if (!tx.signatures[0] || tx.signatures[0].every((byte) => byte === 0)) {
      throw new Error("the transaction carries no fee payer signature");
    }
    const signature = bs58.encode(tx.signatures[0]);
    if (landed.has(signature)) return { result: signature };
    const message = tx.message;
    const keys = message.staticAccountKeys.map((k) => k.toBase58());
    const s = slot();
    const pre = keys.map((k) => accounts.get(k)?.lamports ?? 0);
    const fee = FEE * message.header.numRequiredSignatures;
    const committed = accounts;
    accounts = new Map(
      Array.from(committed, ([key, a]) => [
        key,
        {
          lamports: a.lamports,
          owner: a.owner,
          data: Buffer.from(a.data),
          executable: a.executable,
        },
      ])
    );
    const logs: string[] = [];
    try {
      account(keys[0]).lamports -= fee;
      for (const ix of message.compiledInstructions) {
        const program = keys[ix.programIdIndex];
        const written = apply({
          program,
          keys: ix.accountKeyIndexes.map((i) => keys[i]),
          data: Buffer.from(ix.data),
          s,
        });
        logs.push(...written);
      }
      const short = Array.from(accounts).find(([, a]) => a.lamports < 0);
      if (short) {
        accounts = committed;
        return {
          error: {
            code: -32002,
            message: `Transaction simulation failed: insufficient lamports in ${short[0]}`,
          },
        };
      }
    } catch (error) {
      accounts = committed;
      if (!(error instanceof Unhandled)) unhandled.push(String(error));
      return {
        error: {
          code: -32002,
          message: `Transaction simulation failed: ${String(error)}`,
        },
      };
    }
    landed.set(signature, {
      slot: s,
      blockTime: blockTime(),
      fee,
      logs,
      accountKeys: keys,
      header: message.header,
      instructions: message.compiledInstructions.map((ix) => ({
        programIdIndex: ix.programIdIndex,
        accounts: ix.accountKeyIndexes,
        data: bs58.encode(ix.data),
      })),
      recentBlockhash: message.recentBlockhash,
      preBalances: pre,
      postBalances: keys.map((k) => accounts.get(k)?.lamports ?? 0),
    });
    for (const key of keys) touch(key, { signature, slot: s });
    for (const notify of waiting.get(signature) ?? []) notify();
    waiting.delete(signature);
    changed(keys);
    return { result: signature };
  };

  const encoded = (a: Account | undefined) =>
    a
      ? {
          data: [a.data.toString("base64"), "base64"],
          executable: a.executable,
          lamports: a.lamports,
          owner: a.owner,
          rentEpoch: 0,
          space: a.data.length,
        }
      : // eslint-disable-next-line unicorn/no-null -- JSON-RPC's "no account"
        null;

  const context = () => ({ slot: slot() });

  const answer = (
    method: string,
    params: unknown[]
  ): { result: unknown } | { error: { code: number; message: string } } => {
    switch (method) {
      case "getSlot":
      case "getBlockHeight":
        return { result: slot() };
      case "getBlockTime":
        return { result: blockTime() };
      case "getLatestBlockhash": {
        const s = slot();
        return {
          result: {
            context: { slot: s },
            value: { blockhash: blockhash(s), lastValidBlockHeight: s + 150 },
          },
        };
      }
      case "getBalance":
        return {
          result: {
            context: context(),
            value: accounts.get(params[0] as string)?.lamports ?? 0,
          },
        };
      case "getAccountInfo":
        return {
          result: {
            context: context(),
            value: encoded(accounts.get(params[0] as string)),
          },
        };
      case "getMultipleAccounts":
        return {
          result: {
            context: context(),
            value: (params[0] as string[]).map((k) => encoded(accounts.get(k))),
          },
        };
      case "getMinimumBalanceForRentExemption":
        return { result: rentFor(params[0] as number) };
      case "getRecentPrioritizationFees":
        return { result: [{ slot: slot(), prioritizationFee: 0 }] };
      case "getFeeForMessage":
        return { result: { context: context(), value: FEE } };
      case "simulateTransaction":
        return {
          result: {
            context: context(),
            // eslint-disable-next-line unicorn/no-null -- the simulation passed
            value: { err: null, logs: [], unitsConsumed: 1000, accounts: null },
          },
        };
      case "requestAirdrop": {
        if (fake.faucet === "refuse") {
          return {
            error: {
              code: -32603,
              message:
                "Internal error: airdrop request limit reached for today",
            },
          };
        }
        const [to, lamports] = params as [string, number];
        const before = accounts.get(to)?.lamports ?? 0;
        account(to).lamports += lamports;
        const signature = bs58.encode(
          createHash("sha512")
            .update(`airdrop:${to}:${(airdrops += 1)}`)
            .digest()
        );
        const s = slot();
        touch(to, { signature, slot: s });
        changed([to]);
        landed.set(signature, {
          slot: s,
          blockTime: blockTime(),
          fee: 0,
          logs: [],
          accountKeys: [to],
          header: {
            numRequiredSignatures: 0,
            numReadonlySignedAccounts: 0,
            numReadonlyUnsignedAccounts: 0,
          },
          instructions: [],
          recentBlockhash: blockhash(s),
          preBalances: [before],
          postBalances: [before + lamports],
        });
        return { result: signature };
      }
      case "sendTransaction":
        return send(params[0] as string);
      case "getSignatureStatuses":
        return {
          result: {
            context: context(),
            value: (params[0] as string[]).map((sig) => {
              const tx = landed.get(sig);
              return tx
                ? {
                    slot: tx.slot,
                    // eslint-disable-next-line unicorn/no-null -- finalized
                    confirmations: null,
                    // eslint-disable-next-line unicorn/no-null -- it landed
                    err: null,
                    confirmationStatus: "finalized",
                  }
                : // eslint-disable-next-line unicorn/no-null -- not seen
                  null;
            }),
          },
        };
      case "getSignaturesForAddress": {
        const limit = (params[1] as { limit?: number } | undefined)?.limit;
        return {
          result: (touched.get(params[0] as string) ?? [])
            .slice()
            .reverse()
            .slice(0, limit ?? 1000)
            .map((t) => ({
              signature: t.signature,
              slot: t.slot,
              // eslint-disable-next-line unicorn/no-null -- it landed
              err: null,
              // eslint-disable-next-line unicorn/no-null -- no memo
              memo: null,
              blockTime: landed.get(t.signature)?.blockTime ?? blockTime(),
              confirmationStatus: "finalized",
            })),
        };
      }
      case "getTransaction": {
        const tx = landed.get(params[0] as string);
        if (!tx || fake.index === "lag") {
          // eslint-disable-next-line unicorn/no-null -- not seen
          return { result: null };
        }
        return {
          result: {
            slot: tx.slot,
            blockTime: tx.blockTime,
            version: "legacy",
            meta: {
              // eslint-disable-next-line unicorn/no-null -- it landed
              err: null,
              fee: tx.fee,
              preBalances: tx.preBalances,
              postBalances: tx.postBalances,
              innerInstructions: [],
              logMessages: tx.logs,
              preTokenBalances: [],
              postTokenBalances: [],
              loadedAddresses: { writable: [], readonly: [] },
              computeUnitsConsumed: 1000,
            },
            transaction: {
              signatures: [params[0]],
              message: {
                accountKeys: tx.accountKeys,
                header: tx.header,
                instructions: tx.instructions,
                recentBlockhash: tx.recentBlockhash,
              },
            },
          },
        };
      }
      case "getVersion":
        return { result: { "solana-core": "2.1.0", "feature-set": 1 } };
      case "getGenesisHash":
        return { result: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" };
      case "getHealth":
        return { result: "ok" };
      case "getEpochInfo": {
        const s = slot();
        return {
          result: {
            absoluteSlot: s,
            blockHeight: s,
            epoch: 1,
            slotIndex: s,
            slotsInEpoch: 432000,
            transactionCount: 0,
          },
        };
      }
      default:
        unhandled.push(`RPC ${method}`);
        return { error: { code: -32601, message: "Method not found" } };
    }
  };

  await page.route(`${RPC}/**`, async (route: Route) => {
    let body:
      | { id: unknown; method: string; params?: unknown[] }
      | { id: unknown; method: string; params?: unknown[] }[]
      | undefined;
    try {
      body = (route.request().postDataJSON() ?? undefined) as typeof body;
    } catch (error) {
      // Not JSON: recorded here with the cause, then refused below
      unhandled.push(`RPC body is not JSON: ${String(error)}`);
      body = undefined;
    }
    if (!body) {
      unhandled.push(`RPC ${route.request().method()} with no JSON-RPC body`);
      return route.fulfill({ status: 405, body: "" });
    }
    const one = (b: { id: unknown; method: string; params?: unknown[] }) => {
      calls.push(b.method);
      let a: ReturnType<typeof answer>;
      try {
        a = answer(b.method, b.params ?? []);
      } catch (error) {
        // The app sent something the fake cannot read: say so, and fail the call
        unhandled.push(`RPC ${b.method} threw: ${String(error)}`);
        a = { error: { code: -32603, message: String(error) } };
      }
      return "error" in a
        ? { jsonrpc: "2.0", id: b.id, error: a.error }
        : { jsonrpc: "2.0", id: b.id, result: a.result };
    };
    const reply = Array.isArray(body) ? body.map(one) : one(body);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(reply),
    });
  });

  await page.routeWebSocket(`${WS}/**`, (ws: WebSocketRoute) => {
    // A socket the page closed (a reload) hears nothing more, and its
    // subscriptions stop counting
    let isOpen = true;
    const mine = new Set<number>();
    ws.onClose(() => {
      isOpen = false;
      for (const id of mine) watchers.delete(id);
    });
    /** Sends `message`, a whole JSON-RPC 2.0 frame, unless the page closed */
    const reply = (message: { jsonrpc: "2.0"; [field: string]: unknown }) => {
      if (isOpen) ws.send(JSON.stringify(message));
    };
    const subscribe = (id: number) => {
      const subscription = nextSubscription++;
      mine.add(subscription);
      reply({ jsonrpc: "2.0", result: subscription, id });
      return subscription;
    };

    const onMessage = (raw: string | Buffer) => {
      const message = JSON.parse(String(raw)) as {
        id?: number;
        method?: string;
        params?: unknown[];
      };
      // web3's keep-alive, a notification that wants no answer
      if (message.id === undefined && message.method === "ping") return;
      if (message.id === undefined || !message.method) {
        unhandled.push(`websocket message ${String(raw).slice(0, 80)}`);
        return;
      }
      const params = message.params ?? [];
      if (message.method.endsWith("Unsubscribe")) {
        const id = params[0] as number;
        if (mine.delete(id)) watchers.delete(id);
        reply({ jsonrpc: "2.0", result: true, id: message.id });
        return;
      }
      if (message.method === "accountSubscribe") {
        const subscription = subscribe(message.id);
        const address = params[0] as string;
        watchers.set(subscription, {
          address,
          notify: () =>
            reply({
              jsonrpc: "2.0",
              method: "accountNotification",
              params: {
                subscription,
                result: {
                  context: context(),
                  value: encoded(accounts.get(address)),
                },
              },
            }),
        });
        return;
      }
      if (message.method !== "signatureSubscribe") {
        unhandled.push(`websocket ${message.method}`);
        reply({
          jsonrpc: "2.0",
          error: { code: -32601, message: "Method not found" },
          id: message.id,
        });
        return;
      }
      const subscription = subscribe(message.id);
      const signature = params[0] as string;
      const notify = () =>
        reply({
          jsonrpc: "2.0",
          method: "signatureNotification",
          params: {
            subscription,
            result: {
              context: { slot: landed.get(signature)?.slot ?? slot() },
              // eslint-disable-next-line unicorn/no-null -- it landed
              value: { err: null },
            },
          },
        });
      if (landed.has(signature)) notify();
      else
        waiting.set(signature, (waiting.get(signature) ?? []).concat(notify));
    };

    ws.onMessage((raw) => {
      try {
        onMessage(raw);
      } catch (error) {
        unhandled.push(`websocket message threw: ${String(error)}`);
      }
    });
  });

  return fake;
};

/** The program-data header: tag 3, the slot, Some(authority) */
const writeProgramDataHeader = (
  data: Buffer,
  { slot, authority }: { slot: number; authority: string }
) => {
  data.writeUInt32LE(3, 0);
  data.writeBigUInt64LE(BigInt(slot), 4);
  data[12] = 1;
  new PublicKey(authority).toBuffer().copy(data, 13);
};

/**
 * What the deployed `hello` logs: "Hello, World!" for step 2's program, and
 * "Hello, <name>!" from its borsh string argument for step 4's
 */
const helloLog = (
  code: number | undefined,
  args: Buffer
): string | undefined => {
  if (code === HELLO_WORLD) return "Hello, World!";
  if (code === HELLO_NAME && args.length >= 4) {
    const length = args.readUInt32LE(0);
    return `Hello, ${args.subarray(4, 4 + length).toString("utf8")}!`;
  }
  return undefined;
};
