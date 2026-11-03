// A file of its own: `src/commands/` is a runtime module the UI move rule
// never touches, so its tests stay out of the modules (AGENTS.md)
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  wallet: undefined as { isPg: boolean } | undefined,
  answer: true,
  questions: [] as Array<{ msg: string; opts: unknown }>,
}));
const connectExecute = vi.hoisted(() => vi.fn());

vi.mock("../utils", async () => {
  const { TerminalLineError } = await import("../utils/terminal/line-error");
  return {
    PgCommand: { connect: { name: "connect", execute: connectExecute } },
    PgTerminal: {
      get: async () => ({
        waitForInput: async (msg: string, opts: unknown) => {
          env.questions.push({ msg, opts });
          return env.answer;
        },
      }),
    },
    PgWallet: {
      get current() {
        return env.wallet;
      },
    },
    TerminalLineError,
  };
});

import { TerminalLineError } from "../utils/terminal/line-error";
import { checkPgWallet, checkWallet } from "./checks";

beforeEach(() => {
  env.wallet = undefined;
  env.answer = true;
  env.questions = [];
  connectExecute.mockClear();
});

describe("commands/checks", () => {
  it("asks Spec 13's question for the Playground Wallet, default yes", async () => {
    await checkPgWallet();

    expect(env.questions).toEqual([
      {
        msg: "Playground Wallet is not connected. Connect it?",
        opts: { confirm: true, default: "yes" },
      },
    ]);
    expect(connectExecute).toHaveBeenCalledOnce();
  });

  it("asks to connect the Playground Wallet when no wallet is connected", async () => {
    await checkWallet();

    expect(env.questions.map((q) => q.msg)).toEqual([
      "No wallet is connected. Connect the Playground Wallet?",
    ]);
    // `connect` with no argument is the Playground Wallet
    expect(connectExecute).toHaveBeenCalledWith();
  });

  it("asks nothing when any wallet is connected", async () => {
    env.wallet = { isPg: false };

    await checkWallet();

    expect(env.questions).toEqual([]);
  });

  it("ends the command with Spec 13's line, no prefix, on a no", async () => {
    env.answer = false;

    const run = checkPgWallet();

    await expect(run).rejects.toBeInstanceOf(TerminalLineError);
    await expect(run).rejects.toThrow(
      "Run `connect` to connect a wallet, then try again."
    );
    expect(connectExecute).not.toHaveBeenCalled();
  });

  it("asks nothing when the Playground Wallet is connected", async () => {
    env.wallet = { isPg: true };

    await checkPgWallet();

    expect(env.questions).toEqual([]);
  });
});
