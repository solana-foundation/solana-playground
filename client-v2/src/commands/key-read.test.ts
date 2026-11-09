// A file of its own: `src/commands/` is a runtime module the UI move rule
// never touches, so its tests stay out of the modules (AGENTS.md).
//
// Under the key origin the terminal cannot read the built-in wallet's key,
// so a CLI run that would read it ends with one line before it starts; a run
// that never reads it, and every run under the local provider, goes on.
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ hasKeysInPage: false }));

vi.mock("../utils", async () => {
  const { TerminalLineError } = await import("../utils/terminal/line-error");
  return {
    PgPackage: {},
    PgWallet: { hasKeysInPage: () => env.hasKeysInPage },
    TerminalLineError,
  };
});

import { TerminalLineError } from "../utils/terminal/line-error";
import {
  CLI_KEY_ERROR,
  keyCommandLine,
} from "../utils/wallet/key-origin/cli-line";
import { anchor } from "./anchor";
import { checkPgWallet } from "./checks";
import { solana } from "./solana";
import { splToken } from "./spl-token";
import { sugar } from "./sugar";

/** Run a command's pre-checks before the wallet question on `input` */
const refusalOf = async (
  cmd: { preChecks?: unknown },
  input: string
): Promise<unknown> => {
  const checks = [cmd.preChecks].flat() as Array<
    (tokens: readonly string[]) => unknown
  >;
  const tokens = input.split(" ");
  try {
    for (const check of checks) {
      if (check === checkPgWallet) return undefined;
      await check(tokens);
    }
  } catch (e) {
    return e;
  }
  return undefined;
};

beforeEach(() => {
  env.hasKeysInPage = false;
});

describe("commands that read the wallet's key, under the key origin", () => {
  it.each([
    ["solana balance", "solana"],
    ["solana config get", "solana"],
    ["spl-token accounts", "spl-token"],
    ["anchor idl init", "anchor idl init"],
    [
      "anchor idl upgrade 11111111111111111111111111111111",
      "anchor idl upgrade",
    ],
    ["anchor idl write-buffer", "anchor idl write-buffer"],
  ])("`%s` ends with the key line naming `%s`", async (input, named) => {
    const cmd = { solana, "spl-token": splToken, anchor }[
      input.split(" ")[0] as "solana"
    ];

    const err = await refusalOf(cmd, input);

    expect(err).toBeInstanceOf(TerminalLineError);
    expect((err as Error).message).toBe(keyCommandLine(`\`${named}\``));
  });

  it.each([
    "solana",
    "solana --help",
    "solana help",
    "spl-token -V",
    "anchor idl fetch",
    "anchor idl authority",
    "anchor idl init --help",
    "anchor",
    "sugar launch",
  ])("`%s` never reads the key and goes on", async (input) => {
    const cmd = { solana, "spl-token": splToken, anchor, sugar }[
      input.split(" ")[0] as "solana"
    ];

    expect(await refusalOf(cmd, input)).toBeUndefined();
  });

  it("refuses before the wallet question", () => {
    for (const cmd of [solana, splToken, anchor]) {
      const checks = [cmd.preChecks].flat();
      expect(checks.indexOf(checkPgWallet)).toBe(checks.length - 1);
    }
  });
});

describe("under the local provider", () => {
  it.each(["solana balance", "spl-token accounts", "anchor idl init"])(
    "`%s` goes on",
    async (input) => {
      env.hasKeysInPage = true;
      const cmd = { solana, "spl-token": splToken, anchor }[
        input.split(" ")[0] as "solana"
      ];

      expect(await refusalOf(cmd, input)).toBeUndefined();
    }
  );
});

describe("the key line", () => {
  it("says which command, why, and what to use instead", () => {
    expect(keyCommandLine("`solana`")).toBe(
      "`solana` can't run here: it needs the Playground wallet's key, which this app keeps on a separate origin the terminal can't read. Deploy with `deploy` or Build & Deploy, or sign from a client script with `pg.wallet`."
    );
  });

  it("is the one `getKeypairBytes` throws, unnamed", () => {
    expect(CLI_KEY_ERROR).toBe(keyCommandLine("This command"));
  });
});
