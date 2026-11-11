/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { Idl } from "@coral-xyz/anchor";

import type { RunInput, RunStage } from "../ports";
import type { Exists, RunResult, UnreadTx } from "../progress";
import type { AccountData } from "./account-read";
import { readingOf } from "./account-read";
import type { Captured } from "./capture";
import { isRetriedSend } from "./capture";
import type { FundingChain } from "./fund";
import { fundForDeploy } from "./fund";
import type { DecodedCall, SentTx } from "./transactions";
import { existingOf, resultOf } from "./transactions";

/** A run's or a call's result */
type TxResult = Extract<RunResult, { act: "run" | "call" }>;

/** The stages' labels, as the act card shows them */
export const RUN_STAGES = {
  funding: "Funding your wallet",
  running: "Running client.ts",
  sending: "Sending",
  confirming: "Confirming",
} as const;

/**
 * Lamports a run or call wants in the wallet before it starts: enough for
 * the rent of the biggest account a tutorial's call creates (Zero Copy's big
 * map, about 0.5 SOL), so a call never fails half way on rent. Under it the
 * wallet is topped up, as a deploy's is.
 */
export const RUN_FLOOR = 500_000_000;

/**
 * Lamports under which a run does not start when the faucet refused the top
 * up: a few transactions' fees. Between this and `RUN_FLOOR` it runs anyway,
 * since a call that creates no account (Hello Anchor's) needs no more.
 */
const FEE_FLOOR = 1_000_000;

/** What a landed transaction's record says, read back from the chain */
export interface Landed {
  log: string[];
  /** The transaction's error, or null when it succeeded */
  err: unknown;
  computeUnits: number | null;
  fee: number;
  signer: string | null;
}

/** What the run and the call need from Playground and devnet */
export interface RunPort {
  /** Why a run cannot happen here (another cluster), or null */
  refusal(): string | null;
  /** The address that signs and pays, or null when there is no wallet */
  wallet(): string | null;
  /** The deployed program's id, or null before the first deploy */
  programId(): string | null;
  funding: FundingChain;
  /** The cluster's faucet amount in whole SOL */
  capSol: number;
  /**
   * Runs `client.ts`, or sends the call, with every transaction it hands to
   * the chain captured; `error` is what the run or call threw, if anything
   */
  send(
    act: "run" | "call",
    input: RunInput
  ): Promise<{ captured: Captured[]; error: unknown }>;
  /** A sent transaction once confirmed, or null when it never was */
  landed(signature: string): Promise<Landed | null>;
  /**
   * The address `idl` derives for the account `creates` names from its seeds,
   * with the wallet and the deployed program; undefined for an account with
   * no seeds, whose address would be a guess
   */
  createdAddress(
    creates: NonNullable<RunInput["creates"]>,
    idl: Idl | undefined
  ): Promise<string | undefined>;
  /** An account's bytes and fields now, if it exists, decoded by `idl` */
  fetchAccount(
    address: string,
    idl: Idl | undefined
  ): Promise<AccountData | undefined>;
  /**
   * The wire transaction's instructions to the program, decoded by its IDL;
   * `undecoded` when one of them could not be
   */
  decode(
    encoded: string,
    idl: RunInput["idl"]
  ): { calls: DecodedCall[]; undecoded?: true };
  print(line: string): void;
  /** Logs a failure the team should hear of, with what was happening */
  report(error: unknown, stage: string): void;
  now(): number;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A failed call's line when the learner's program no longer matches what the
 * step expects. The conversation adds the offer to show the lines (`view.ts`);
 * the Call panel has no such action, so this line promises none.
 */
export const MISMATCH =
  "Your code no longer matches what this step expects. Fix it in the editor and build and deploy again.";

/** The call names an instruction the IDL it is sent through lacks */
export class NoSuchInstructionError extends Error {
  constructor(instruction: string) {
    super(`The IDL has no \`${instruction}\``);
    this.name = "NoSuchInstructionError";
  }
}

/**
 * Anchor's own refusals of an instruction it cannot match: 101
 * `InstructionFallbackNotFound` (no instruction with that discriminator) and
 * 102 `InstructionDidNotDeserialize` (its arguments are not the program's)
 */
const MISMATCH_CODES = new Set([101, 102]);

const mismatched = (result: TxResult): TxResult =>
  result.ok || result.reason === "no_funds" || result.reason === "unconfirmed"
    ? result
    : { ...result, message: MISMATCH, mismatch: true };

/**
 * Runs `client.ts` (the run act) or sends one instruction (the call act)
 * from the learner's wallet on devnet, and answers what the chain made of
 * every transaction it sent. Stages: "Funding your wallet" first when the
 * wallet is short, then "Running client.ts" or "Sending", then
 * "Confirming". A run that could not happen is a failed result, never a
 * throw: an unexpected one is reported and becomes the failure's message.
 */
export const runOrCall = async (
  port: RunPort,
  act: "run" | "call",
  input: RunInput,
  onStage: (stage: RunStage) => void
): Promise<TxResult> => {
  const started = port.now();
  const seconds = () => (port.now() - started) / 1000;
  // A check that could not read is still a check to make: what it would
  // have read stays, so "Check again" stays and a press does not send anew
  const fail = (message: string): TxResult =>
    input.recheck
      ? {
          act,
          ok: false,
          seconds: seconds(),
          reason: "unconfirmed",
          message,
          log: "",
          unconfirmed: input.recheck,
        }
      : { act, ok: false, seconds: seconds(), message, log: "" };
  try {
    return await attempt(port, act, input, onStage, seconds, fail);
  } catch (e) {
    port.report(e, `The tutorial ${act}`);
    return fail(messageOf(e));
  }
};

const attempt = async (
  port: RunPort,
  act: "run" | "call",
  input: RunInput,
  onStage: (stage: RunStage) => void,
  seconds: () => number,
  fail: (message: string) => TxResult
): Promise<TxResult> => {
  const refusal = port.refusal();
  if (refusal) return fail(refusal);
  if (input.recheck) {
    // "Check again" only reads what was sent, and reading needs no wallet
    const programId = port.programId();
    if (!programId) return fail("Deploy the program first.");
    onStage({ label: RUN_STAGES.confirming, index: 1, count: 1 });
    const sent: SentTx[] = [];
    for (const tx of input.recheck) sent.push(await readBack(port, tx));
    return landedResult(port, act, input, sent, programId, seconds, fail);
  }
  const address = port.wallet();
  if (!address) {
    return {
      act,
      ok: false,
      seconds: seconds(),
      reason: "no_wallet",
      message: "Create a Playground wallet or connect one, then try again.",
      log: "",
    };
  }
  const programId = port.programId();
  if (!programId) return fail("Deploy the program first.");

  const balance = await port.funding.balance(address);
  const short = balance < RUN_FLOOR;
  const labels = [
    ...(short ? [RUN_STAGES.funding] : []),
    act === "run" ? RUN_STAGES.running : RUN_STAGES.sending,
    RUN_STAGES.confirming,
  ];
  let index = 0;
  const stage = (label: string) =>
    onStage({ label, index: ++index, count: labels.length });

  if (short) {
    stage(RUN_STAGES.funding);
    const funded = await fundForDeploy({
      chain: port.funding,
      address,
      need: RUN_FLOOR,
      capSol: port.capSol,
      onShort: (sol) => port.print(`Airdropping ${sol} SOL...`),
    });
    if (!funded.ok && funded.balance < FEE_FLOOR) {
      return {
        act,
        ok: false,
        seconds: seconds(),
        reason: "no_funds",
        message: funded.message,
        log: "",
        funding: { balance: funded.balance, cost: RUN_FLOOR, address },
      };
    }
  }

  stage(labels[index]);
  const sends = await port.send(act, input);
  return fromSends({
    port,
    act,
    input,
    sends,
    programId,
    seconds,
    fail,
    onConfirming: () => stage(RUN_STAGES.confirming),
  });
};

/** What `fromSends` reads a run's or call's result from */
interface Sent {
  port: RunPort;
  act: "run" | "call";
  input: RunInput;
  /** What the run handed to the chain, and what it threw, if anything */
  sends: { captured: Captured[]; error: unknown };
  programId: string;
  seconds: () => number;
  fail: (message: string) => TxResult;
  /** The sends are in: reading them back starts */
  onConfirming: () => void;
}

/**
 * The result of what a run or call sent: nothing sent, the refusals, and
 * each sent transaction read back from devnet
 */
const fromSends = async ({
  port,
  act,
  input,
  sends,
  programId,
  seconds,
  fail,
  onConfirming,
}: Sent): Promise<TxResult> => {
  // A try `PgTx.send` answered by sending again is not a refusal; after its last resend the answer arrives as `error`
  const captured = sends.captured.filter((c) => !isRetriedSend(c));
  const { error } = sends;

  if (!captured.length) {
    if (error instanceof NoSuchInstructionError) {
      return mismatched(fail(messageOf(error)));
    }
    if (error !== undefined) return fail(messageOf(error));
    const exists =
      act === "run" ? await existingAccount(port, input) : undefined;
    return {
      act,
      ok: false,
      seconds: seconds(),
      reason: "no_transaction",
      message:
        act === "run"
          ? "client.ts sent no transaction. See the terminal."
          : "The call sent no transaction.",
      log: "",
      ...(exists ? { exists } : {}),
    };
  }

  onConfirming();
  const sent: SentTx[] = [];
  for (const c of captured) {
    const { calls, undecoded } = port.decode(c.encoded, input.idl);
    if (c.kind === "refused") {
      sent.push({ kind: "refused", log: c.log, message: c.message, calls });
      continue;
    }
    sent.push(
      await readBack(port, {
        signature: c.signature,
        calls,
        ...(undecoded ? { undecoded } : {}),
      })
    );
  }
  return landedResult(port, act, input, sent, programId, seconds, fail, error);
};

/**
 * A run of the client file started outside its act card (the terminal's
 * `run`, the explorer's Run), read as the run act reads its own: what it
 * sent, read back from devnet, against the live step's `input`. Nothing is
 * funded, staged or printed: the run has already happened. Undefined when there
 * is no program to read its calls against, off devnet, or when the reading
 * failed (reported).
 *
 * @param port the run port the act uses
 * @param input the live step's run input
 * @param sends what the run handed to the chain, and what it threw
 * @param startedAt when it started, for the result's seconds
 * @returns the result the run act would have posted for the same sends
 */
export const readOutsideRun = async (
  port: RunPort,
  input: RunInput,
  sends: { captured: Captured[]; error: unknown },
  startedAt: number
): Promise<TxResult | undefined> => {
  // Another cluster's run is no step's: tutorials run on devnet
  if (port.refusal()) return undefined;
  const programId = port.programId();
  if (!programId) return undefined;
  const seconds = () => (port.now() - startedAt) / 1000;
  try {
    return await fromSends({
      port,
      act: "run",
      input,
      sends,
      programId,
      seconds,
      fail: (message) => ({
        act: "run",
        ok: false,
        seconds: seconds(),
        message,
        log: "",
      }),
      onConfirming: () => {},
    });
  } catch (e) {
    port.report(e, "Reading a client run outside its card");
    return undefined;
  }
};

/**
 * The account the live goal `creates`, when a client run sent nothing because
 * it found it: read at the address its seeds give. A lookup that fails is
 * reported and finds nothing, so the run stays "No transaction"
 */
const existingAccount = async (
  port: RunPort,
  input: RunInput
): Promise<Exists | undefined> => {
  const { creates } = input;
  if (!creates) return undefined;
  try {
    const address = await port.createdAddress(creates, input.idl);
    if (address === undefined) return undefined;
    const found = await port.fetchAccount(address, input.idl);
    return found
      ? { instruction: creates.instruction, account: creates.account, address }
      : undefined;
  } catch (e) {
    port.report(e, "Looking up the account a run would create");
    return undefined;
  }
};

/**
 * A sent transaction read back from devnet: landed, or unread when devnet did
 * not answer in the read window, which on a slow devnet is no refusal
 */
const readBack = async (port: RunPort, tx: UnreadTx): Promise<SentTx> => {
  const landed = await port.landed(tx.signature).catch((e) => {
    port.report(e, "Reading a sent transaction back");
    return null;
  });
  return landed
    ? { kind: "landed", ...tx, ...landed }
    : { kind: "unread", ...tx };
};

/**
 * The result of what was sent, and the account the act draws once it landed;
 * `error` is what the run threw after sending, if anything
 */
const landedResult = async (
  port: RunPort,
  act: "run" | "call",
  input: RunInput,
  sent: SentTx[],
  programId: string,
  seconds: () => number,
  fail: (message: string) => TxResult,
  error?: unknown
): Promise<TxResult> => {
  const result = resultOf({
    act,
    sent,
    programId,
    pattern: input.log,
    seconds: seconds(),
  });
  // What landed stands, but a run that threw after it did not finish, and a
  // check would not change that: the throw is the answer, not a slow devnet
  const unfinished = result.ok || result.reason === "unconfirmed";
  if (unfinished && error !== undefined) return fail(messageOf(error));
  if (!result.ok) {
    const code = result.refused?.error?.code;
    if (code !== undefined && MISMATCH_CODES.has(code)) {
      return mismatched(result);
    }
    if (result.reason === undefined) {
      const exists = existingOf(
        result.log.split("\n"),
        result.refused,
        input.creates
      );
      if (exists) return { ...result, exists };
    }
    return result;
  }
  if (!input.account) return result;
  // The run landed whatever the read says: a card goes without, never the run
  const account = await readingOf({
    wrote: result.wrote ?? [],
    name: input.account,
    fetchAccount: (key) => port.fetchAccount(key, input.idl),
  }).catch((e) => {
    port.report(e, "Reading the account a run wrote to");
    return null;
  });
  if (account === null) return result;
  if (!account) {
    // The card would go missing with nothing to say why: a misnamed account
    port.report(
      new Error(`The run left no account named ${input.account} to read`),
      "Reading the account a run wrote to"
    );
    return result;
  }
  return { ...result, account };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("features/tutorial-conversation/model/runners/run-call", () => {
    const SOL = 1_000_000_000;
    const PROGRAM = "He11o1111111111111111111111111111111111111";
    const WALLET = "Wa11et1111111111111111111111111111111111111";
    const HELLO_LOG = [
      `Program ${PROGRAM} invoke [1]`,
      "Program log: Instruction: Hello",
      "Program log: Hello, World!",
      `Program ${PROGRAM} success`,
    ];
    const HELLO_TX: Landed = {
      log: HELLO_LOG,
      err: null,
      computeUnits: 389,
      fee: 5000,
      signer: WALLET,
    };
    const HELLO_CALL: DecodedCall = {
      instruction: "hello",
      args: {},
      accounts: [],
      wrote: [],
    };

    /** A port on devnet with a funded wallet whose run sends one `hello` */
    const portWith = (over: {
      balances?: number[];
      airdrop?: FundingChain["airdrop"];
      send?: RunPort["send"];
      landed?: RunPort["landed"];
      createdAddress?: RunPort["createdAddress"];
      fetchAccount?: RunPort["fetchAccount"];
      wallet?: string | null;
      programId?: string | null;
      refusal?: string | null;
    }): RunPort => {
      const balances = over.balances ?? [2 * SOL];
      let clock = 1000;
      return {
        refusal: () => over.refusal ?? null,
        wallet: () => (over.wallet === undefined ? WALLET : over.wallet),
        programId: () =>
          over.programId === undefined ? PROGRAM : over.programId,
        funding: {
          balance: vi.fn(
            async () =>
              (balances.length > 1 ? balances.shift() : undefined) ??
              balances[0]
          ),
          airdrop: vi.fn(over.airdrop ?? (async () => "airdrop")),
          confirm: async () => true,
        },
        capSol: 5,
        send:
          over.send ??
          (async () => ({
            captured: [{ kind: "sent", signature: "5ig", encoded: "tx" }],
            error: undefined,
          })),
        landed: over.landed ?? (async () => HELLO_TX),
        createdAddress: over.createdAddress ?? (async () => undefined),
        fetchAccount: over.fetchAccount ?? (async () => undefined),
        decode: () => ({ calls: [HELLO_CALL] }),
        print: () => {},
        report: vi.fn(),
        now: () => (clock += 500),
      };
    };

    // HOO-2806: a run started outside its card, read as the card reads its own
    describe("readOutsideRun", () => {
      const SENT = {
        captured: [{ kind: "sent" as const, signature: "5ig", encoded: "tx" }],
        error: undefined,
      };
      const INPUT = { beatId: "client-run", log: "Hello, World!" };

      it("reads what it sent as the act would, and funds nothing", async () => {
        const port = portWith({});
        await expect(
          readOutsideRun(port, INPUT, SENT, 0)
        ).resolves.toMatchObject({ act: "run", ok: true });
        expect(port.funding.balance).not.toHaveBeenCalled();
        expect(port.funding.airdrop).not.toHaveBeenCalled();
      });

      it("judges nothing off devnet, or with no program deployed", async () => {
        await expect(
          readOutsideRun(
            portWith({ refusal: "Switch to devnet." }),
            INPUT,
            SENT,
            0
          )
        ).resolves.toBeUndefined();
        await expect(
          readOutsideRun(portWith({ programId: null }), INPUT, SENT, 0)
        ).resolves.toBeUndefined();
      });

      it("is a run that threw when the script threw after sending", async () => {
        await expect(
          readOutsideRun(
            portWith({}),
            INPUT,
            { captured: SENT.captured, error: new Error("x is undefined") },
            0
          )
        ).resolves.toMatchObject({ ok: false, message: "x is undefined" });
      });
    });

    describe("the account an act draws", () => {
      const CHOP: Captured = { kind: "sent", signature: "sig", encoded: "tx" };
      const portOf = (fetchIt: RunPort["fetchAccount"]): RunPort => ({
        refusal: () => null,
        wallet: () => WALLET,
        programId: () => PROGRAM,
        funding: {
          balance: async () => 10 * SOL,
          airdrop: async () => "",
          confirm: async () => undefined,
        } as unknown as FundingChain,
        capSol: 5,
        send: async () => ({ captured: [CHOP], error: undefined }),
        landed: async () => HELLO_TX,
        createdAddress: async () => undefined,
        fetchAccount: fetchIt,
        decode: () => ({
          calls: [
            {
              instruction: "chop_tree",
              args: {},
              accounts: [],
              wrote: [{ name: "player", address: "Player1" }],
            },
          ],
        }),
        print: () => undefined,
        report: vi.fn(),
        now: () => 0,
      });

      it("reads it once the run landed", async () => {
        const fetched = vi.fn(async () => ({
          size: 32,
          fields: { wood: "1" },
        }));
        const result = await runOrCall(
          portOf(fetched),
          "call",
          { beatId: "chop", account: "player" },
          () => undefined
        );
        expect(fetched).toHaveBeenCalledWith("Player1", undefined);
        expect(result).toMatchObject({
          ok: true,
          account: { name: "player", address: "Player1", size: 32 },
        });
      });

      it("keeps the run and reports it when the read fails", async () => {
        const port = portOf(async () => {
          throw new Error("no answer");
        });
        const result = await runOrCall(
          port,
          "call",
          { beatId: "chop", account: "player" },
          () => undefined
        );
        expect(result.ok).toBe(true);
        expect(result).not.toHaveProperty("account");
        expect(port.report).toHaveBeenCalled();
      });

      it("reports an act's account the run has no reading of", async () => {
        const port = portOf(async () => undefined);
        const result = await runOrCall(
          port,
          "call",
          { beatId: "chop", account: "player" },
          () => undefined
        );
        expect(result.ok).toBe(true);
        expect(port.report).toHaveBeenCalledTimes(1);
      });

      it("reads nothing for an act that names no account", async () => {
        const fetched = vi.fn(async () => undefined);
        await runOrCall(
          portOf(fetched),
          "call",
          { beatId: "chop" },
          () => undefined
        );
        expect(fetched).not.toHaveBeenCalled();
      });
    });

    const stagesOf = async (port: RunPort, act: "run" | "call" = "run") => {
      const stages: RunStage[] = [];
      const result = await runOrCall(
        port,
        act,
        { beatId: "s3.run", log: "Hello, World!" },
        (s) => stages.push(s)
      );
      return { result, stages };
    };

    it("Hello Anchor's step 3: the run's transaction comes back with its line and receipt", async () => {
      const { result, stages } = await stagesOf(portWith({}));
      expect(stages).toEqual([
        { label: "Running client.ts", index: 1, count: 2 },
        { label: "Confirming", index: 2, count: 2 },
      ]);
      expect(result).toMatchObject({
        act: "run",
        ok: true,
        signatures: ["5ig"],
        line: "Program log: Hello, World!",
        called: [{ instruction: "hello", args: {} }],
        receipt: { fee: 5000, computeUnits: 389, signer: WALLET },
      });
    });

    it("tops a short wallet up first, as its own stage", async () => {
      const port = portWith({ balances: [0, 0, 5 * SOL] });
      const { result, stages } = await stagesOf(port, "call");
      expect(stages.map((s) => `${s.label} ${s.index}/${s.count}`)).toEqual([
        "Funding your wallet 1/3",
        "Sending 2/3",
        "Confirming 3/3",
      ]);
      expect(port.funding.airdrop).toHaveBeenCalledOnce();
      expect(result.ok).toBe(true);
    });

    it("stops with the faucet's facts when the airdrop is refused and the wallet cannot pay a fee", async () => {
      const port = portWith({
        balances: [0],
        airdrop: async () => {
          throw new Error("429 Too Many Requests");
        },
      });
      const { result } = await stagesOf(port);
      expect(result).toMatchObject({
        ok: false,
        reason: "no_funds",
        message: "429 Too Many Requests",
        funding: { balance: 0, cost: RUN_FLOOR, address: WALLET },
      });
    });

    it("runs anyway when the airdrop is refused but the wallet still pays fees", async () => {
      const port = portWith({
        balances: [SOL / 10],
        airdrop: async () => {
          throw new Error("429 Too Many Requests");
        },
      });
      expect((await stagesOf(port)).result.ok).toBe(true);
    });

    it("a run that sent nothing is no transaction; a call that threw first is its message", async () => {
      const quiet = portWith({
        send: async () => ({ captured: [], error: undefined }),
      });
      expect((await stagesOf(quiet)).result).toMatchObject({
        ok: false,
        reason: "no_transaction",
        message: "client.ts sent no transaction. See the terminal.",
      });
      const threw = portWith({
        send: async () => ({
          captured: [],
          error: new Error("Account `user` not provided."),
        }),
      });
      const { result } = await stagesOf(threw, "call");
      expect(result).toMatchObject({
        ok: false,
        message: "Account `user` not provided.",
      });
      expect(result).not.toHaveProperty("reason");
    });

    describe("runOrCall", () => {
      const CREATES = { instruction: "init_player", account: "player" };
      const runWith = (port: RunPort, act: "run" | "call") =>
        runOrCall(
          port,
          act,
          { beatId: "s2.run", creates: CREATES },
          () => undefined
        );

      it("names the player a client run found at its seeds' address, having sent nothing", async () => {
        const fetched = vi.fn(async () => ({ size: 32, fields: {} }));
        const port = portWith({
          send: async () => ({ captured: [], error: undefined }),
          createdAddress: async () => "Player1",
          fetchAccount: fetched,
        });
        expect(await runWith(port, "run")).toMatchObject({
          ok: false,
          reason: "no_transaction",
          exists: {
            instruction: "init_player",
            account: "player",
            address: "Player1",
          },
        });
        expect(fetched).toHaveBeenCalledWith("Player1", undefined);
      });

      it("keeps no transaction when a client run sent nothing and found no player", async () => {
        const port = portWith({
          send: async () => ({ captured: [], error: undefined }),
          createdAddress: async () => "Player1",
        });
        expect(await runWith(port, "run")).not.toHaveProperty("exists");
      });

      it("names the player the System Program refused to create as already in use", async () => {
        const log = [
          `Program ${PROGRAM} invoke [1]`,
          "Program 11111111111111111111111111111111 invoke [2]",
          "Allocate: account Address { address: Player1, base: None } already in use",
          "Program 11111111111111111111111111111111 failed: custom program error: 0x0",
          `Program ${PROGRAM} failed: custom program error: 0x0`,
        ];
        const port = portWith({
          send: async () => ({
            captured: [{ kind: "refused", encoded: "tx", message: "0x0", log }],
            error: new Error("Simulation failed."),
          }),
        });
        port.decode = () => ({
          calls: [
            { instruction: "initPlayer", args: {}, accounts: [], wrote: [] },
          ],
        });
        expect(await runWith(port, "call")).toMatchObject({
          ok: false,
          exists: {
            instruction: "init_player",
            account: "player",
            address: "Player1",
          },
        });
      });
    });

    it("a refused send fails with the program's refusal, so the step does not pass", async () => {
      const port = portWith({
        send: async () => ({
          captured: [
            {
              kind: "refused",
              encoded: "tx",
              message: "custom program error: 0x1770",
              log: [
                `Program ${PROGRAM} invoke [1]`,
                "Program log: Instruction: Hello",
                `Program ${PROGRAM} failed: custom program error: 0x1770`,
              ],
            },
          ],
          error: new Error("Simulation failed."),
        }),
      });
      expect((await stagesOf(port, "call")).result).toMatchObject({
        act: "call",
        ok: false,
        refused: { instruction: "hello", error: { code: 6000, name: null } },
      });
    });

    it("a call the program cannot match says the code no longer matches the step", async () => {
      const refusedWith = (code: string, name: string) =>
        portWith({
          send: async () => ({
            captured: [
              {
                kind: "refused",
                encoded: "tx",
                message: `custom program error: ${code}`,
                log: [
                  `Program ${PROGRAM} invoke [1]`,
                  `Program log: AnchorError occurred. Error Code: ${name}. Error Number: ${Number(
                    code
                  )}. Error Message: x.`,
                  `Program ${PROGRAM} failed: custom program error: ${code}`,
                ],
              },
            ],
            error: new Error("Simulation failed."),
          }),
        });
      for (const [code, name] of [
        ["0x65", "InstructionFallbackNotFound"],
        ["0x66", "InstructionDidNotDeserialize"],
      ]) {
        expect(
          (await stagesOf(refusedWith(code, name), "call")).result
        ).toMatchObject({ ok: false, mismatch: true, message: MISMATCH });
      }
      // The program's own error is the lesson's, not a mismatch
      const own = (await stagesOf(refusedWith("0x1770", "Custom"), "call"))
        .result;
      expect(own).not.toHaveProperty("mismatch");
    });

    it("never calls a run that could not be funded or confirmed a mismatch", () => {
      const refused: TxResult = {
        act: "call",
        ok: false,
        seconds: 1,
        message: "m",
        log: "",
      };
      const unconfirmed: TxResult = {
        act: "call",
        ok: false,
        seconds: 1,
        message: "m",
        log: "",
        reason: "unconfirmed",
        unconfirmed: [],
      };
      const noFunds: TxResult = {
        act: "call",
        ok: false,
        seconds: 1,
        message: "m",
        log: "",
        reason: "no_funds",
        funding: { balance: 0, cost: 1, address: "a" },
      };
      expect(mismatched(unconfirmed)).toBe(unconfirmed);
      expect(mismatched(noFunds)).toBe(noFunds);
      expect(mismatched(refused)).toMatchObject({ mismatch: true });
    });

    it("a call of an instruction the IDL lacks says the same", async () => {
      const port = portWith({
        send: async () => ({
          captured: [],
          error: new NoSuchInstructionError("hello"),
        }),
      });
      expect((await stagesOf(port, "call")).result).toMatchObject({
        ok: false,
        mismatch: true,
        message: MISMATCH,
      });
    });

    it("a transaction devnet does not read back in time is unconfirmed, not refused", async () => {
      const port = portWith({ landed: async () => null });
      expect((await stagesOf(port, "call")).result).toEqual({
        act: "call",
        ok: false,
        seconds: expect.any(Number),
        reason: "unconfirmed",
        message:
          "Devnet has not confirmed this transaction yet. Check again, or open it in Explorer.",
        log: "",
        unconfirmed: [{ signature: "5ig", calls: [HELLO_CALL] }],
      });
    });

    it("a read that throws is unconfirmed too, and reported", async () => {
      const port = portWith({
        landed: async () => {
          throw new Error("Transaction was not confirmed in 30.00 seconds");
        },
      });
      expect((await stagesOf(port, "call")).result).toMatchObject({
        ok: false,
        reason: "unconfirmed",
      });
      expect(port.report).toHaveBeenCalledOnce();
    });

    it("a run that threw after a send devnet has not read back fails with the throw, not unconfirmed", async () => {
      const port = portWith({
        send: async () => ({
          captured: [{ kind: "sent", signature: "5ig", encoded: "tx" }],
          error: new Error("second call: Account `user` not provided."),
        }),
        landed: async () => null,
      });
      const { result } = await stagesOf(port, "run");
      expect(result).toMatchObject({
        ok: false,
        message: "second call: Account `user` not provided.",
      });
      expect(result).not.toHaveProperty("reason");
    });

    describe("Check again", () => {
      const RECHECK = {
        beatId: "s3.call",
        log: "Hello, World!",
        recheck: [{ signature: "5ig", calls: [HELLO_CALL] }],
      };

      it("reads the same signature again, with no funding and no send, and lands", async () => {
        const send = vi.fn(async () => ({ captured: [], error: undefined }));
        const landed = vi.fn(async () => HELLO_TX);
        const port = portWith({ balances: [0], send, landed });
        const stages: RunStage[] = [];
        const result = await runOrCall(port, "call", RECHECK, (s) =>
          stages.push(s)
        );
        expect(send).not.toHaveBeenCalled();
        expect(port.funding.balance).not.toHaveBeenCalled();
        expect(landed).toHaveBeenCalledWith("5ig");
        expect(stages).toEqual([{ label: "Confirming", index: 1, count: 1 }]);
        expect(result).toMatchObject({
          act: "call",
          ok: true,
          signatures: ["5ig"],
          line: "Program log: Hello, World!",
          called: [{ instruction: "hello", args: {} }],
        });
      });

      it("stays unconfirmed while devnet still has not read it back", async () => {
        const port = portWith({ landed: async () => null });
        expect(
          await runOrCall(port, "call", RECHECK, () => undefined)
        ).toMatchObject({ ok: false, reason: "unconfirmed" });
      });

      it("fails with the program's error once it reads back failed", async () => {
        const port = portWith({
          landed: async () => ({
            log: [
              `Program ${PROGRAM} invoke [1]`,
              `Program ${PROGRAM} failed: custom program error: 0x1770`,
            ],
            err: { InstructionError: [0, { Custom: 6000 }] },
            computeUnits: 389,
            fee: 5000,
            signer: WALLET,
          }),
        });
        const result = await runOrCall(port, "call", RECHECK, () => undefined);
        expect(result).toMatchObject({
          ok: false,
          refused: { instruction: "hello", error: { code: 6000 } },
        });
        expect(result).not.toHaveProperty("reason");
      });

      it("needs no wallet: it only reads", async () => {
        const port = portWith({ wallet: null });
        expect(
          await runOrCall(port, "call", RECHECK, () => undefined)
        ).toMatchObject({ ok: true, signatures: ["5ig"] });
      });

      it("that cannot read keeps the transactions to check, with the reason as its message", async () => {
        const port = portWith({
          refusal:
            "Tutorials run on devnet. Switch the network to devnet in Settings and try again.",
        });
        expect(await runOrCall(port, "call", RECHECK, () => undefined)).toEqual(
          {
            act: "call",
            ok: false,
            seconds: expect.any(Number),
            reason: "unconfirmed",
            message:
              "Tutorials run on devnet. Switch the network to devnet in Settings and try again.",
            log: "",
            unconfirmed: RECHECK.recheck,
          }
        );
      });

      it("that throws keeps the transactions to check, and reports", async () => {
        const port = portWith({});
        port.programId = () => {
          throw new Error("program info broke");
        };
        const result = await runOrCall(port, "call", RECHECK, () => undefined);
        expect(result).toMatchObject({
          ok: false,
          reason: "unconfirmed",
          message: "program info broke",
          unconfirmed: RECHECK.recheck,
        });
        expect(port.report).toHaveBeenCalledOnce();
      });
    });

    it("a call that landed on PgTx.send's blockhash retry is confirmed, not refused", async () => {
      const port = portWith({
        send: async () => ({
          captured: [
            {
              kind: "refused",
              encoded: "tx",
              message: "Blockhash not found",
              log: [],
            },
            { kind: "sent", signature: "5ig", encoded: "tx" },
          ],
          error: undefined,
        }),
      });
      expect((await stagesOf(port, "call")).result).toMatchObject({
        ok: true,
        signatures: ["5ig"],
      });
    });

    it("a run that threw after its transaction landed fails with the throw", async () => {
      const port = portWith({
        send: async () => ({
          captured: [{ kind: "sent", signature: "5ig", encoded: "tx" }],
          error: new Error("Cannot read properties of undefined"),
        }),
      });
      expect((await stagesOf(port)).result).toMatchObject({
        ok: false,
        message: "Cannot read properties of undefined",
      });
    });

    it("an unexpected throw from the chain is a reported failure, never a throw", async () => {
      const port = portWith({});
      port.funding.balance = async () => {
        throw new Error("fetch failed");
      };
      expect((await stagesOf(port)).result).toMatchObject({
        ok: false,
        message: "fetch failed",
      });
      expect(port.report).toHaveBeenCalledOnce();
    });

    it("refuses to start with no wallet, off devnet, or before a deploy", async () => {
      expect((await stagesOf(portWith({ wallet: null }))).result).toMatchObject(
        { ok: false, reason: "no_wallet" }
      );
      // The wallet is asked for first, before a deploy
      expect(
        (await stagesOf(portWith({ wallet: null, programId: null }))).result
      ).toMatchObject({ ok: false, reason: "no_wallet" });
      expect(
        (await stagesOf(portWith({ refusal: "Switch to devnet." }))).result
      ).toMatchObject({ ok: false, message: "Switch to devnet." });
      expect(
        (await stagesOf(portWith({ programId: null }))).result
      ).toMatchObject({ ok: false, message: "Deploy the program first." });
    });
  });
}
