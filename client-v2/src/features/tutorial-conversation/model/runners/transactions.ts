/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import { sameIdlName } from "@/shared/lib/idl-name";
import { LINE_BREAK } from "@/shared/lib/line-break";
import { createLogger } from "@/shared/lib/logger";
import { isProgramLog } from "@/shared/lib/program-log";

import type {
  Called,
  Exists,
  Receipt,
  ReceiptAccount,
  Refusal,
  RunResult,
  UnreadTx,
} from "../progress";

/**
 * One transaction a run or call sent, as the chain answered it: landed
 * (confirmed, with or without an error), or refused before it landed (the
 * preflight's simulation failed, or the send threw).
 */
export type SentTx =
  | {
      kind: "landed";
      signature: string;
      log: string[];
      /** The transaction's error, or null when it succeeded */
      err: unknown;
      computeUnits: number | null;
      fee: number;
      signer: string | null;
      /** The instructions it sent to the tutorial's program, decoded */
      calls: DecodedCall[];
      /** One of them did not decode, so `calls` may be short */
      undecoded?: true;
    }
  | {
      kind: "refused";
      /** The simulation's log, empty when the send failed before it */
      log: string[];
      message: string;
      calls: DecodedCall[];
    }
  /** Sent, and devnet has not read it back yet: it may still land */
  | ({ kind: "unread" } & UnreadTx);

/** An instruction to the tutorial's program, as the deployed IDL decodes it */
export interface DecodedCall extends Called {
  accounts: ReceiptAccount[];
  /** Of `accounts`, the ones the call may write to, other than the wallet */
  wrote: ReceiptAccount[];
}

/** An account of an IDL instruction, composite accounts holding their own */
export interface IdlAccountName {
  name: string;
  accounts?: IdlAccountName[];
}

/** An instruction's account names as its IDL spells them, in wire order */
const flatNames = (accounts: IdlAccountName[]): string[] =>
  accounts.flatMap((a) => (a.accounts ? flatNames(a.accounts) : [a.name]));

/**
 * The accounts a call may write to, other than the transaction's payer, by
 * their IDL names. The names come from the IDL and not from Anchor's formatter,
 * which sentence-cases them for display ("Big Map"), since a later call looks
 * them up against the IDL.
 */
export const accountsWritten = (
  accounts: IdlAccountName[],
  metas: { address: string; isWritable: boolean; isPayer: boolean }[]
): ReceiptAccount[] => {
  const names = flatNames(accounts);
  return metas.flatMap((meta, i) =>
    meta.isWritable && !meta.isPayer && names[i] !== undefined
      ? [{ name: names[i], address: meta.address }]
      : []
  );
};

/** The part of a Test form's account value this module reads and fills */
export interface AccountValue {
  name: string;
  isSigner: boolean;
  generator: { type: string };
}

const FILLABLE = new Set(["Custom", "Random"]);

/**
 * A call's account values with the remembered addresses over the generators
 * that derive nothing (`Custom`, `Random`). A signer keeps its generator, since
 * an address cannot sign; so does an account from seeds, since an argument may
 * change what it derives to.
 */
export const fillRememberedWith =
  (remembered: Record<string, string>) =>
  <T extends AccountValue>(accounts: T[]): T[] =>
    accounts.map((account) => {
      if (account.isSigner || !FILLABLE.has(account.generator.type)) {
        return account;
      }
      const found = Object.entries(remembered).find(([name]) =>
        sameIdlName(name, account.name)
      );
      return found
        ? { ...account, generator: { type: "Custom", value: found[1] } }
        : account;
    });

const logger = createLogger("tutorial-conversation:transactions");

/** Anchor logs the instruction's name first, in the program's own frame */
const INSTRUCTION = /^Program log: Instruction: (\w+)/;
const ANCHOR_ERROR = "AnchorError";
const ERROR_CODE = "Error Code: ";
const ERROR_MESSAGE = " Error Message: ";
/** What follows `Error Code: `, read in place with the sticky flag */
const ERROR_CODE_TAIL = /(\w+)\. Error Number: (\d+)\./y;
const CUSTOM_ERROR = /custom program error: 0x([0-9a-f]+)/i;
const INVOKE = /^Program (\w+) invoke \[\d+\]$/;
const EXIT = /^Program (\w+) (success|failed)/;

/**
 * The `Program log:` lines the tutorial's program wrote itself, in order:
 * not a program it invoked, and not Anchor's `Instruction:` line
 */
export const programLines = (log: string[], programId: string): string[] => {
  const stack: string[] = [];
  const out: string[] = [];
  for (const line of log) {
    const invoke = INVOKE.exec(line);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    if (EXIT.test(line)) {
      stack.pop();
      continue;
    }
    if (
      stack[stack.length - 1] === programId &&
      isProgramLog(line) &&
      !INSTRUCTION.test(line)
    ) {
      out.push(line);
    }
  }
  return out;
};

/** Unanchored and case-blind, as the goal's judge reads a pattern */
const matcher = (pattern: string | undefined): ((line: string) => boolean) => {
  if (pattern === undefined) return () => true;
  try {
    // eslint-disable-next-line security/detect-non-literal-regexp -- a shipped tutorial's pattern, which `yarn tutorial:check` compiles
    const re = new RegExp(pattern, "i");
    return (line) => re.test(line);
  } catch (e) {
    // The judge reports a broken pattern to the team; here the card still
    // shows the program's first line
    logger.warn(
      "A step's log pattern does not compile; showing the first line",
      {
        context: { pattern, error: e instanceof Error ? e.message : String(e) },
      }
    );
    return () => true;
  }
};

/**
 * The card's large line: the first line of the program's own log the step's
 * pattern matches, over every transaction in order; with no match, the
 * program's first line, so the card shows what came back even when the goal
 * does not pass. Null when the program logged nothing.
 */
export const pickLine = (
  logs: string[][],
  programId: string,
  pattern: string | undefined
): string | null => {
  const lines = logs.flatMap((log) => programLines(log, programId));
  const matches = matcher(pattern);
  return lines.find(matches) ?? lines[0] ?? null;
};

/** The error an Anchor program logged, with its message when it gave one */
const anchorError = (log: string[]) => {
  for (const line of log) {
    const error = anchorErrorOf(line);
    if (error) return error;
  }
  return null;
};

/**
 * What `/AnchorError.*Error Code: (\w+)\. Error Number: (\d+)\.(?: Error
 * Message: (.*?)\.?$)?/` would read, found with `lastIndexOf`, since the
 * regex backtracks quadratically on a long line. The last `Error Code: `
 * whose tail parses wins, as the greedy `.*` chooses.
 */
const anchorErrorOf = (line: string) => {
  const segments = line.split(LINE_BREAK);
  for (const [i, segment] of segments.entries()) {
    const start = segment.indexOf(ANCHOR_ERROR);
    if (start === -1) continue;
    const from = start + ANCHOR_ERROR.length;
    for (
      let at = segment.lastIndexOf(ERROR_CODE);
      at >= from;
      at = segment.lastIndexOf(ERROR_CODE, at - 1)
    ) {
      ERROR_CODE_TAIL.lastIndex = at + ERROR_CODE.length;
      const tail = ERROR_CODE_TAIL.exec(segment);
      if (!tail) continue;
      const rest = segment.slice(ERROR_CODE_TAIL.lastIndex);
      // The message runs to the end of the input, so only the last segment has one
      const hasMessage =
        i === segments.length - 1 && rest.startsWith(ERROR_MESSAGE);
      const message = hasMessage
        ? rest.slice(ERROR_MESSAGE.length).replace(/\.$/, "")
        : null;
      return { name: tail[1], code: Number(tail[2]), message };
    }
  }
  return null;
};

/** Whether the tutorial's program ran at all in this log, at any depth */
const reached = (log: string[], programId: string) =>
  log.some((line) => line.startsWith(`Program ${programId} invoke [`));

/**
 * What the program refused: the instruction (decoded, else from Anchor's
 * `Instruction:` line) and the error (Anchor's, else the custom code the
 * runtime names). Undefined when the transaction never reached the program,
 * so a `refused` goal cannot pass on a send that failed elsewhere.
 */
export const refusalOf = (
  log: string[],
  programId: string,
  calls: DecodedCall[]
): Refusal | undefined => {
  if (!reached(log, programId)) return undefined;
  const named = log.map((l) => INSTRUCTION.exec(l)?.[1]).find(Boolean);
  const instruction = calls[0]?.instruction ?? named;
  if (!instruction) return undefined;
  const anchor = anchorError(log);
  if (anchor) {
    return { instruction, error: { code: anchor.code, name: anchor.name } };
  }
  const custom = log.map((l) => CUSTOM_ERROR.exec(l)?.[1]).find(Boolean);
  return {
    instruction,
    error: custom ? { code: parseInt(custom, 16), name: null } : null,
  };
};

/** The System Program's line when the account to create is already there */
const IN_USE = /^(?:Allocate|Create Account): account .*already in use$/;
const IN_USE_ADDRESS = /address: (\w+)/;

/** A transaction devnet has read back, or refused */
type ReadTx = Exclude<SentTx, { kind: "unread" }>;

/** It failed: refused, or landed with an error */
const failed = (tx: SentTx): tx is ReadTx =>
  tx.kind === "refused" || (tx.kind === "landed" && tx.err !== null);

/** The first System Program "already in use" line in a log, if any */
const inUseLine = (log: string[]): string | undefined =>
  log.find((l) => IN_USE.test(l));

type Creates = { instruction: string; account: string };

/**
 * How a failed transaction ties the account in use at `address` to the one
 * `creates` names. `match`: a decoded call of that instruction wrote the
 * account, under its IDL name, at that address. `fallback`: nothing decoded
 * says either way (a call of that instruction decoded with nothing written,
 * or no call decoded and Anchor's `Instruction:` line names it), so the log
 * line's address stands on its own. `none`: the decoded calls show another
 * account or another instruction, or nothing names the instruction at all.
 * Known limit: on `fallback`, an instruction that creates two accounts and
 * finds only the second in use reads as the first existing; it takes an
 * undecoded call, which the deployed IDL normally rules out
 */
const tieFor =
  (creates: Creates) =>
  (tx: ReadTx, address: string): "match" | "fallback" | "none" => {
    if (tx.calls.length === 0) {
      const named = tx.log.map((l) => INSTRUCTION.exec(l)?.[1]).find(Boolean);
      return named !== undefined && sameIdlName(named, creates.instruction)
        ? "fallback"
        : "none";
    }
    // `wrote` carries IDL names; `accounts` has Anchor's display names
    // ("Big Map"), which no IDL name matches
    const wrote = tx.calls
      .filter((c) => sameIdlName(c.instruction, creates.instruction))
      .flatMap((c) => c.wrote);
    if (wrote.length === 0) {
      return tx.calls.some((c) =>
        sameIdlName(c.instruction, creates.instruction)
      )
        ? "fallback"
        : "none";
    }
    return wrote.some(
      (a) => a.address === address && sameIdlName(a.name, creates.account)
    )
      ? "match"
      : "none";
  };

/**
 * The existing account behind a refusal of the instruction that creates it:
 * the System Program's "already in use" with its error 0, in that
 * instruction, at the address the call wrote as the account it creates. Every
 * failed transaction is read: one whose decoded call wrote the account there
 * wins; else one whose calls say nothing either way (see `tieFor`) lends the
 * log line's address. Undefined for any other refusal, for an address a
 * decoded call shows is another account or another instruction's, or with
 * nothing to create. An "already in use" line that ties to no such account is
 * logged, so a second pass stuck on its init card leaves a trace
 */
export const existingOf = (
  sent: SentTx[],
  refused: Refusal | undefined,
  creates: Creates | undefined
): Exists | undefined => {
  if (
    !creates ||
    !refused ||
    refused.error?.code !== 0 ||
    !sameIdlName(refused.instruction, creates.instruction)
  ) {
    return undefined;
  }
  const tieOf = tieFor(creates);
  const inUse = sent.filter(failed).flatMap((tx) => {
    const line = inUseLine(tx.log);
    if (line === undefined) return [];
    const address = IN_USE_ADDRESS.exec(line)?.[1];
    return [{ line, address, tie: address ? tieOf(tx, address) : "none" }];
  });
  const found =
    inUse.find((u) => u.tie === "match") ??
    inUse.find((u) => u.tie === "fallback");
  if (found?.address) {
    return {
      instruction: creates.instruction,
      account: creates.account,
      address: found.address,
    };
  }
  if (inUse.length > 0) {
    logger.warn("An account in use ties to no account the call creates", {
      context: {
        instruction: creates.instruction,
        account: creates.account,
        lines: inUse.map((u) => u.line),
      },
    });
  }
  return undefined;
};

/**
 * A failure in a sentence: Anchor's message (else its error name); for a
 * refused send, the RPC's first line; for a landed transaction with no
 * Anchor error, its error as the chain gives it
 */
const reasonOf = (tx: ReadTx): string => {
  const anchor = anchorError(tx.log);
  if (anchor?.message) return anchor.message;
  if (anchor) return anchor.name;
  if (tx.kind === "refused") return tx.message.split("\n")[0];
  return `The transaction failed: ${JSON.stringify(tx.err)}`;
};

/** A sent transaction as it is kept to be read again */
const unreadOf = (tx: Exclude<SentTx, { kind: "refused" }>): UnreadTx => ({
  signature: tx.signature,
  calls: tx.calls,
  ...(tx.undecoded ? { undecoded: tx.undecoded } : {}),
});

/**
 * One result from every transaction a run or call sent; `sent` is never
 * empty (`runOrCall` answers a run that sent nothing itself). Any failure fails
 * the run, with the first failure's reason, log and refusal; else a
 * transaction devnet has not read back makes it unconfirmed, with every
 * transaction to read again; otherwise the run landed, with every signature,
 * the picked line, every call to the program, and the last transaction's
 * receipt.
 */
export const resultOf = ({
  act,
  sent,
  programId,
  pattern,
  seconds,
}: {
  act: "run" | "call";
  sent: SentTx[];
  programId: string;
  pattern: string | undefined;
  seconds: number;
}): Extract<RunResult, { act: "run" | "call" }> => {
  const failure = sent.find(failed);
  if (failure) {
    const refused = refusalOf(failure.log, programId, failure.calls);
    return {
      act,
      ok: false,
      seconds,
      message: reasonOf(failure),
      log: failure.log.join("\n"),
      ...(refused ? { refused } : {}),
    };
  }
  const unread = sent.find(
    (tx): tx is Extract<SentTx, { kind: "unread" }> => tx.kind === "unread"
  );
  if (unread) {
    return {
      act,
      ok: false,
      seconds,
      reason: "unconfirmed",
      message:
        "Devnet has not confirmed this transaction yet. Check again, or open it in Explorer.",
      log: "",
      // With no failure, every transaction was sent and none refused
      unconfirmed: sent.flatMap((tx) =>
        tx.kind === "refused" ? [] : [unreadOf(tx)]
      ),
    };
  }
  const landed = sent.filter(
    (tx): tx is Extract<SentTx, { kind: "landed" }> => tx.kind === "landed"
  );
  // `sent` holds a transaction, and with no failure every one landed
  const last = landed[landed.length - 1];
  const wrote = landed.flatMap((tx) => tx.calls.flatMap((c) => c.wrote));
  return {
    act,
    ok: true,
    ...(wrote.length ? { wrote } : {}),
    seconds,
    signatures: landed.map((tx) => tx.signature),
    line: pickLine(
      landed.map((tx) => tx.log),
      programId,
      pattern
    ),
    called: landed.flatMap((tx) =>
      tx.calls.map(({ instruction, args }) => ({ instruction, args }))
    ),
    ...(landed.some((tx) => tx.undecoded) ? { undecoded: true as const } : {}),
    receipt: receiptOf(last, programId),
  };
};

/** The rows the result card and the finish card's receipt draw */
const receiptOf = (
  tx: Extract<SentTx, { kind: "landed" }>,
  programId: string
): Receipt => {
  const receipt: Receipt = { fee: tx.fee, log: tx.log };
  if (tx.signer) receipt.signer = tx.signer;
  if (tx.computeUnits !== null) receipt.computeUnits = tx.computeUnits;
  receipt.accounts = [
    { name: "program", address: programId },
    ...tx.calls.flatMap((c) => c.accounts),
  ];
  return receipt;
};

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("features/tutorial-conversation/model/runners/transactions", () => {
    describe("anchorErrorOf", () => {
      const TAIL = "Error Code: Late. Error Number: 6001.";
      it.each([
        [
          "Program log: AnchorError occurred. Error Code: Low. Error Number: 6000. Error Message: Too low.",
          { name: "Low", code: 6000, message: "Too low" },
        ],
        [
          "AnchorError occurred. Error Code: Low. Error Number: 6000.",
          { name: "Low", code: 6000, message: null },
        ],
        // The last code whose tail parses, as a greedy `.*` picked it
        [
          `AnchorError ${TAIL} Error Code: Bad. ${TAIL}`,
          { name: "Late", code: 6001, message: null },
        ],
        [`${TAIL} AnchorError`, null],
        // A line break ends the search, and a message must reach the end
        [`AnchorError\n${TAIL}`, null],
        [
          `AnchorError ${TAIL} Error Message: x.\nmore`,
          { name: "Late", code: 6001, message: null },
        ],
        // The code's tail must start right after `Error Code: `
        ["AnchorError Error Code: a b. Error Number: 1.", null],
      ])("reads %j", (line, expected) => {
        expect(anchorErrorOf(line)).toEqual(expected);
      });

      it.each([
        { label: "AnchorError repeats", line: "AnchorError ".repeat(30_000) },
        {
          label: "Error Code: repeats",
          line: `AnchorError ${"Error Code: x".repeat(40_000)}`,
        },
      ])(
        "parses a long line of $label in linear time",
        ({ line }) => {
          expect(anchorErrorOf(line)).toBeNull();
        },
        1000
      );
    });

    describe("accountsWritten", () => {
      it("names what a call wrote to as the IDL does, past the payer and read-only accounts", () => {
        expect(
          accountsWritten(
            [
              { name: "big_map" },
              { name: "signer" },
              { name: "system_program" },
            ],
            [
              { address: "Map1", isWritable: true, isPayer: false },
              { address: "Wallet", isWritable: true, isPayer: true },
              { address: "Sys", isWritable: false, isPayer: false },
            ]
          )
        ).toEqual([{ name: "big_map", address: "Map1" }]);
      });

      it("walks composite accounts in wire order, and skips remaining accounts", () => {
        expect(
          accountsWritten(
            [{ name: "game", accounts: [{ name: "board" }] }, { name: "map" }],
            [
              { address: "B", isWritable: true, isPayer: false },
              { address: "M", isWritable: true, isPayer: false },
              { address: "Extra", isWritable: true, isPayer: false },
            ]
          )
        ).toEqual([
          { name: "board", address: "B" },
          { name: "map", address: "M" },
        ]);
      });
    });

    describe("fillRememberedWith", () => {
      it("fills an account by its IDL name, across snake and camel case", () => {
        expect(
          fillRememberedWith({ big_map: "Map1" })([
            { name: "bigMap", isSigner: false, generator: { type: "Random" } },
          ])
        ).toEqual([
          {
            name: "bigMap",
            isSigner: false,
            generator: { type: "Custom", value: "Map1" },
          },
        ]);
      });

      it("keeps a signer's generator, an account from seeds and an account it does not know", () => {
        const accounts = [
          { name: "map", isSigner: true, generator: { type: "Random" } },
          {
            name: "big_map",
            isSigner: false,
            generator: { type: "From seed" },
          },
          { name: "other", isSigner: false, generator: { type: "Random" } },
        ];
        expect(
          fillRememberedWith({ map: "Map1", big_map: "Map2" })(accounts)
        ).toEqual(accounts);
      });
    });

    const PROGRAM = "He11o1111111111111111111111111111111111111";
    const WALLET = "Wa11et1111111111111111111111111111111111111";

    /** Hello Anchor's step 3, as devnet logged it */
    const HELLO_LOG = [
      `Program ${PROGRAM} invoke [1]`,
      "Program log: Instruction: Hello",
      "Program log: Hello, World!",
      `Program ${PROGRAM} consumed 389 of 200000 compute units`,
      `Program ${PROGRAM} success`,
    ];

    /** Lumberjack's chop with no energy left, as Anchor 0.29 logs it */
    const CHOP_LOG = [
      `Program ${PROGRAM} invoke [1]`,
      "Program log: Instruction: ChopTree",
      "Program log: AnchorError thrown in programs/lumberjack/src/lib.rs:31:9. Error Code: NotEnoughEnergy. Error Number: 6000. Error Message: Not enough energy.",
      `Program ${PROGRAM} consumed 4210 of 200000 compute units`,
      `Program ${PROGRAM} failed: custom program error: 0x1770`,
    ];

    const hello = (args: Record<string, string> = {}): DecodedCall => ({
      instruction: "hello",
      args,
      accounts: [],
      wrote: [],
    });

    const landed = (
      log: string[],
      calls: DecodedCall[] = [hello()],
      err: unknown = null
    ): SentTx => ({
      kind: "landed",
      signature: `sig${log.length}`,
      log,
      err,
      computeUnits: 389,
      fee: 5000,
      signer: WALLET,
      calls,
    });

    describe("pickLine", () => {
      it("picks the program's own line the pattern matches", () => {
        expect(pickLine([HELLO_LOG], PROGRAM, "Hello, World!")).toBe(
          "Program log: Hello, World!"
        );
      });

      it("skips Anchor's Instruction line and a program it invoked", () => {
        const log = [
          `Program ${PROGRAM} invoke [1]`,
          "Program log: Instruction: Hello",
          "Program 11111111111111111111111111111111 invoke [2]",
          "Program log: from the system program",
          "Program 11111111111111111111111111111111 success",
          "Program log: Hello, Alex!",
          `Program ${PROGRAM} success`,
        ];
        expect(pickLine([log], PROGRAM, undefined)).toBe(
          "Program log: Hello, Alex!"
        );
      });

      it("finds the match in a later transaction, else shows the first line", () => {
        const other = [
          `Program ${PROGRAM} invoke [1]`,
          "Program log: Setting up",
          `Program ${PROGRAM} success`,
        ];
        expect(pickLine([other, HELLO_LOG], PROGRAM, "hello, world")).toBe(
          "Program log: Hello, World!"
        );
        expect(pickLine([other, HELLO_LOG], PROGRAM, "Goodbye")).toBe(
          "Program log: Setting up"
        );
      });

      it("answers null when the program logged nothing, and survives a broken pattern", () => {
        expect(pickLine([[]], PROGRAM, "x")).toBeNull();
        expect(pickLine([HELLO_LOG], PROGRAM, "(")).toBe(
          "Program log: Hello, World!"
        );
      });
    });

    describe("refusalOf", () => {
      it("reads Anchor's error and the decoded instruction", () => {
        expect(
          refusalOf(CHOP_LOG, PROGRAM, [
            { instruction: "chop_tree", args: {}, accounts: [], wrote: [] },
          ])
        ).toEqual({
          instruction: "chop_tree",
          error: { code: 6000, name: "NotEnoughEnergy" },
        });
      });

      it("falls back to the Instruction line and the runtime's custom code", () => {
        const log = [
          `Program ${PROGRAM} invoke [1]`,
          "Program log: Instruction: ChopTree",
          `Program ${PROGRAM} failed: custom program error: 0x1771`,
        ];
        expect(refusalOf(log, PROGRAM, [])).toEqual({
          instruction: "ChopTree",
          error: { code: 6001, name: null },
        });
      });

      it("names no error for a panic, and no refusal when the program never ran", () => {
        const panic = [
          `Program ${PROGRAM} invoke [1]`,
          "Program log: Instruction: Grow",
          `Program ${PROGRAM} failed: SBF program panicked`,
        ];
        expect(refusalOf(panic, PROGRAM, [])).toEqual({
          instruction: "Grow",
          error: null,
        });
        expect(refusalOf([], PROGRAM, [hello()])).toBeUndefined();
      });
    });

    describe("existingOf", () => {
      const SYSTEM = "11111111111111111111111111111111";
      const PLAYER = "3azZ1111111111111111111111111111111111111111";
      const VAULT = "4bzZ1111111111111111111111111111111111111111";
      const inUse = (address: string) =>
        `Allocate: account Address { address: ${address}, base: None } already in use`;
      /** Lumberjack's `init_player` on a player that exists, as devnet logged it (HOO-2362) */
      const initLog = (systemLine: string, code: string) => [
        `Program ${PROGRAM} invoke [1]`,
        "Program log: Instruction: InitPlayer",
        `Program ${SYSTEM} invoke [2]`,
        systemLine,
        `Program ${SYSTEM} failed: custom program error: ${code}`,
        `Program ${PROGRAM} failed: custom program error: ${code}`,
      ];
      /** `init_player` passing the player, and a vault it also creates */
      const init: DecodedCall = {
        instruction: "initPlayer",
        args: {},
        accounts: [
          { name: "Player", address: PLAYER },
          { name: "Vault", address: VAULT },
        ],
        wrote: [
          { name: "player", address: PLAYER },
          { name: "vault", address: VAULT },
        ],
      };
      const CREATES = { instruction: "init_player", account: "player" };
      const existingFor = (calls: DecodedCall[]) => (log: string[]) =>
        existingOf(
          [{ kind: "refused", log, message: "0x0", calls }],
          refusalOf(log, PROGRAM, calls),
          CREATES
        );
      const existing = existingFor([init]);

      it("names the account the System Program found already in use", () => {
        expect(existing(initLog(inUse(PLAYER), "0x0"))).toEqual({
          instruction: "init_player",
          account: "player",
          address: PLAYER,
        });
      });

      it("finds none in another refusal with error 0, whose log names no account in use", () => {
        const log = initLog("Program log: Error: something else", "0x0");
        expect(existing(log)).toBeUndefined();
      });

      it("finds none when the address in use is another account the instruction creates", () => {
        expect(existing(initLog(inUse(VAULT), "0x0"))).toBeUndefined();
      });

      it("finds none when the call that failed did not pass the account at that address", () => {
        const other: DecodedCall = {
          instruction: "initPlayer",
          args: {},
          accounts: [{ name: "Player", address: VAULT }],
          wrote: [{ name: "player", address: VAULT }],
        };
        expect(
          existingFor([other])(initLog(inUse(PLAYER), "0x0"))
        ).toBeUndefined();
      });

      it("takes the log line's address when no call decoded to say otherwise", () => {
        const found = {
          instruction: "init_player",
          account: "player",
          address: PLAYER,
        };
        // The call did not decode: `refusalOf` names it from Anchor's line
        expect(existingFor([])(initLog(inUse(PLAYER), "0x0"))).toEqual(found);
        // It decoded, with nothing written at all
        const bare: DecodedCall = {
          instruction: "initPlayer",
          args: {},
          accounts: [{ name: "Player", address: PLAYER }],
          wrote: [],
        };
        expect(existingFor([bare])(initLog(inUse(PLAYER), "0x0"))).toEqual(
          found
        );
      });

      it("finds the account in a transaction that landed with an error", () => {
        const log = initLog(inUse(PLAYER), "0x0");
        const tx: SentTx = {
          kind: "landed",
          signature: "sig",
          log,
          err: { InstructionError: [0, { Custom: 0 }] },
          computeUnits: 3000,
          fee: 5000,
          signer: null,
          calls: [init],
        };
        expect(
          existingOf([tx], refusalOf(log, PROGRAM, [init]), CREATES)
        ).toMatchObject({ address: PLAYER });
      });

      it("finds the account in a failed transaction past the first", () => {
        const first = initLog("Program log: Error: something else", "0x0");
        const later = initLog(inUse(PLAYER), "0x0");
        expect(
          existingOf(
            [
              { kind: "refused", log: first, message: "0x0", calls: [init] },
              { kind: "refused", log: later, message: "0x0", calls: [init] },
            ],
            refusalOf(first, PROGRAM, [init]),
            CREATES
          )
        ).toMatchObject({ address: PLAYER });
      });

      it("finds none, and logs it, when the line in use names no address it can read", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const log = initLog(
            "Allocate: account Address { 3azZ, base: None } already in use",
            "0x0"
          );
          expect(existing(log)).toBeUndefined();
          expect(JSON.stringify(warn.mock.calls)).toContain(
            "ties to no account the call creates"
          );
        } finally {
          warn.mockRestore();
        }
      });

      it("logs nothing when it finds the account, or when no line says in use", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          existing(initLog(inUse(PLAYER), "0x0"));
          existing(initLog("Program log: Error: something else", "0x0"));
          expect(warn).not.toHaveBeenCalled();
        } finally {
          warn.mockRestore();
        }
      });

      it("finds none when the decoded call wrote only another account", () => {
        const vaultOnly: DecodedCall = {
          instruction: "initPlayer",
          args: {},
          accounts: [{ name: "Vault", address: VAULT }],
          wrote: [{ name: "vault", address: VAULT }],
        };
        expect(
          existingFor([vaultOnly])(initLog(inUse(VAULT), "0x0"))
        ).toBeUndefined();
      });

      it("takes no address from a failed transaction of another instruction", () => {
        const first = initLog("Program log: Error: something else", "0x0");
        /** `init_vault`, undecoded, refused on a vault already there */
        const vaultLog = [
          `Program ${PROGRAM} invoke [1]`,
          "Program log: Instruction: InitVault",
          `Program ${SYSTEM} invoke [2]`,
          inUse(VAULT),
          `Program ${SYSTEM} failed: custom program error: 0x0`,
          `Program ${PROGRAM} failed: custom program error: 0x0`,
        ];
        const vaultCall: DecodedCall = {
          instruction: "initVault",
          args: {},
          accounts: [{ name: "Vault", address: VAULT }],
          wrote: [{ name: "vault", address: VAULT }],
        };
        const refused = refusalOf(first, PROGRAM, [init]);
        for (const calls of [[], [vaultCall]]) {
          expect(
            existingOf(
              [
                { kind: "refused", log: first, message: "0x0", calls: [init] },
                { kind: "refused", log: vaultLog, message: "0x0", calls },
              ],
              refused,
              CREATES
            )
          ).toBeUndefined();
        }
        // Undecoded, with no `Instruction:` line to name it
        const bare = vaultLog.filter((l) => !l.includes("Instruction:"));
        expect(
          existingOf(
            [{ kind: "refused", log: bare, message: "0x0", calls: [] }],
            { instruction: "initPlayer", error: { code: 0, name: null } },
            CREATES
          )
        ).toBeUndefined();
      });

      it("prefers a decoded call that wrote the account over a log line alone", () => {
        const undecoded = initLog(inUse(VAULT), "0x0");
        const decoded = initLog(inUse(PLAYER), "0x0");
        expect(
          existingOf(
            [
              { kind: "refused", log: undecoded, message: "0x0", calls: [] },
              { kind: "refused", log: decoded, message: "0x0", calls: [init] },
            ],
            refusalOf(undecoded, PROGRAM, []),
            CREATES
          )
        ).toMatchObject({ address: PLAYER });
      });

      it("matches a creates of two words by its IDL name, not Anchor's display name", () => {
        const log = initLog(inUse(PLAYER), "0x0");
        const big: DecodedCall = {
          instruction: "initBigMap",
          args: {},
          accounts: [{ name: "Big Map", address: PLAYER }],
          wrote: [{ name: "big_map", address: PLAYER }],
        };
        expect(
          existingOf(
            [{ kind: "refused", log, message: "0x0", calls: [big] }],
            { instruction: "initBigMap", error: { code: 0, name: null } },
            { instruction: "init_big_map", account: "big_map" }
          )
        ).toEqual({
          instruction: "init_big_map",
          account: "big_map",
          address: PLAYER,
        });
      });
    });

    describe("resultOf", () => {
      /** `resultOf` for Hello Anchor's step 3, over what was sent */
      const resultFor = (sent: SentTx[], act: "run" | "call" = "run") =>
        resultOf({
          act,
          sent,
          programId: PROGRAM,
          pattern: "Hello, World!",
          seconds: 3,
        });

      it("says a run is undecoded if any of its transactions is", () => {
        const undecoded = Object.assign(landed(HELLO_LOG), { undecoded: true });
        expect(resultFor([undecoded, landed(HELLO_LOG)])).toMatchObject({
          ok: true,
          undecoded: true,
        });
        expect(resultFor([landed(HELLO_LOG)])).not.toHaveProperty("undecoded");
      });

      it("a landed run: signatures, the picked line, the calls and the last receipt", () => {
        expect(resultFor([landed(HELLO_LOG)])).toEqual({
          act: "run",
          ok: true,
          seconds: 3,
          signatures: ["sig5"],
          line: "Program log: Hello, World!",
          called: [{ instruction: "hello", args: {} }],
          receipt: {
            fee: 5000,
            signer: WALLET,
            computeUnits: 389,
            log: HELLO_LOG,
            accounts: [{ name: "program", address: PROGRAM }],
          },
        });
      });

      it("a refused preflight fails with Anchor's message, its log and the refusal", () => {
        const sent: SentTx[] = [
          {
            kind: "refused",
            log: CHOP_LOG,
            message: "Simulation failed.\nMessage: ...",
            calls: [
              { instruction: "chop_tree", args: {}, accounts: [], wrote: [] },
            ],
          },
        ];
        expect(resultFor(sent, "call")).toEqual({
          act: "call",
          ok: false,
          seconds: 3,
          message: "Not enough energy",
          log: CHOP_LOG.join("\n"),
          refused: {
            instruction: "chop_tree",
            error: { code: 6000, name: "NotEnoughEnergy" },
          },
        });
      });

      it("several landed transactions: every signature, every call, the last receipt", () => {
        const first: SentTx = {
          kind: "landed",
          signature: "first",
          log: HELLO_LOG,
          err: null,
          computeUnits: 100,
          fee: 5000,
          signer: WALLET,
          calls: [hello()],
        };
        const second: SentTx = {
          kind: "landed",
          signature: "second",
          log: HELLO_LOG,
          err: null,
          computeUnits: 200,
          fee: 10000,
          signer: WALLET,
          calls: [hello({ name: "Alex" })],
        };
        expect(resultFor([first, second])).toMatchObject({
          ok: true,
          signatures: ["first", "second"],
          called: [
            { instruction: "hello", args: {} },
            { instruction: "hello", args: { name: "Alex" } },
          ],
          receipt: { fee: 10000, computeUnits: 200 },
        });
      });

      it("a landed error with no Anchor log names the chain's error", () => {
        const log = [
          `Program ${PROGRAM} invoke [1]`,
          `Program ${PROGRAM} failed: SBF program panicked`,
        ];
        expect(
          resultFor([
            landed(log, [hello()], {
              InstructionError: [0, "ProgramFailedToComplete"],
            }),
          ])
        ).toMatchObject({
          ok: false,
          message:
            'The transaction failed: {"InstructionError":[0,"ProgramFailedToComplete"]}',
          refused: { instruction: "hello", error: null },
        });
      });

      it("a landed transaction with an error fails, even after one that succeeded", () => {
        const result = resultFor([
          landed(HELLO_LOG),
          landed(CHOP_LOG, [], { InstructionError: [0, { Custom: 6000 }] }),
        ]);
        expect(result).toMatchObject({
          ok: false,
          message: "Not enough energy",
        });
      });

      it("a send that failed before the chain carries its first line and no refusal", () => {
        const result = resultFor([
          {
            kind: "refused",
            log: [],
            message: "failed to send transaction: blockhash not found\nmore",
            calls: [hello()],
          },
        ]);
        expect(result).toEqual({
          act: "run",
          ok: false,
          seconds: 3,
          message: "failed to send transaction: blockhash not found",
          log: "",
        });
      });

      it("a sent transaction devnet has not read back is unconfirmed, with every signature to read again", () => {
        const result = resultFor(
          [
            landed(HELLO_LOG),
            { kind: "unread", signature: "late", calls: [hello()] },
          ],
          "call"
        );
        expect(result).toEqual({
          act: "call",
          ok: false,
          seconds: 3,
          reason: "unconfirmed",
          message:
            "Devnet has not confirmed this transaction yet. Check again, or open it in Explorer.",
          log: "",
          unconfirmed: [
            { signature: `sig${HELLO_LOG.length}`, calls: [hello()] },
            { signature: "late", calls: [hello()] },
          ],
        });
      });

      it("a refusal outranks a transaction not read back", () => {
        const result = resultFor([
          { kind: "unread", signature: "late", calls: [hello()] },
          landed(CHOP_LOG, [], { InstructionError: [0, { Custom: 6000 }] }),
        ]);
        expect(result).toMatchObject({
          ok: false,
          message: "Not enough energy",
        });
        expect(result).not.toHaveProperty("reason");
      });
    });
  });
}
