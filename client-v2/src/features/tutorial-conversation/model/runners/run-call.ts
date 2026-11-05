/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { RunInput, RunStage } from "../ports";
import type { RunResult } from "../progress";
import type { AccountData } from "./account-read";
import { readingOf } from "./account-read";
import type { Captured } from "./capture";
import { isRetriedSend } from "./capture";
import type { FundingChain } from "./fund";
import { fundForDeploy } from "./fund";
import type { DecodedCall, SentTx } from "./transactions";
import { resultOf } from "./transactions";

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
  /** An account's bytes and fields now, if it exists */
  fetchAccount(address: string): Promise<AccountData | undefined>;
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
  const fail = (message: string): TxResult => ({
    act,
    ok: false,
    seconds: seconds(),
    message,
    log: "",
  });
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
  // A first try `PgTx.send` answered by sending again is not a refusal
  const captured = sends.captured.filter((c) => !isRetriedSend(c));
  const { error } = sends;

  if (!captured.length) {
    if (error !== undefined) return fail(messageOf(error));
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
    };
  }

  stage(RUN_STAGES.confirming);
  const sent: SentTx[] = [];
  for (const c of captured) {
    const { calls, undecoded } = port.decode(c.encoded, input.idl);
    if (c.kind === "refused") {
      sent.push({ kind: "refused", log: c.log, message: c.message, calls });
      continue;
    }
    const landed = await port.landed(c.signature).catch((e) => {
      port.report(e, "Reading a sent transaction back");
      return null;
    });
    sent.push(
      landed
        ? {
            kind: "landed",
            signature: c.signature,
            calls,
            ...landed,
            ...(undecoded ? { undecoded } : {}),
          }
        : {
            kind: "refused",
            log: [],
            message: `Could not read transaction ${c.signature} back from devnet. Open it in Explorer to see whether it landed.`,
            calls,
          }
    );
  }
  const result = resultOf({
    act,
    sent,
    programId,
    pattern: input.log,
    seconds: seconds(),
  });
  // What landed stands, but a run that threw after it did not finish
  if (result.ok && error !== undefined) return fail(messageOf(error));
  if (!result.ok || !input.account) return result;
  // The run landed whatever the read says: a card goes without, never the run
  const account = await readingOf({
    wrote: result.wrote ?? [],
    name: input.account,
    fetchAccount: (key) => port.fetchAccount(key),
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
        fetchAccount: async () => undefined,
        decode: () => ({ calls: [HELLO_CALL] }),
        print: () => {},
        report: vi.fn(),
        now: () => (clock += 500),
      };
    };

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
        expect(fetched).toHaveBeenCalledWith("Player1");
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

    it("a transaction that never confirms fails", async () => {
      const port = portWith({ landed: async () => null });
      expect((await stagesOf(port)).result).toMatchObject({
        ok: false,
        message:
          "Could not read transaction 5ig back from devnet. Open it in Explorer to see whether it landed.",
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
      expect(
        (await stagesOf(portWith({ refusal: "Switch to devnet." }))).result
      ).toMatchObject({ ok: false, message: "Switch to devnet." });
      expect(
        (await stagesOf(portWith({ programId: null }))).result
      ).toMatchObject({ ok: false, message: "Deploy the program first." });
    });
  });
}
