import type { Option } from "./command";

/**
 * Move the value-taking options a command declares for itself, wherever they
 * stand among its subcommand path, to the end of that path, where the
 * subcommand that runs takes them (clap's global arguments: `solana -u d
 * confirm <signature>` is `solana confirm -u d <signature>`). Tokens stay
 * as they are when no subcommand follows the options. An option given twice
 * before the subcommand keeps its last value, as clap does.
 *
 * Called as `hoistParentOptionsWith(options)(subcommands)(tokens)`.
 *
 * @param options the options the top-level command declares
 * @returns a function from the subcommands, nested ones as a tree, to a function from the input tokens (the command's name first) to the tokens with those options moved
 */
export const hoistParentOptionsWith =
  (options: readonly Option[]) =>
  (subcommands: readonly SubcommandTree[]) =>
  (tokens: string[]) => {
    const valueOptionOf = (token: string) =>
      options.find(
        (opt) =>
          opt.takeValue &&
          (token === `--${opt.name}` || token === `-${opt.short}`)
      );

    const path: string[] = [tokens[0]];
    // Each option's token and value, by the option's name: a repeat replaces
    const moved = new Map<string, [string, string]>();
    let level = subcommands;
    let i = 1;
    for (; i < tokens.length; i++) {
      const token = tokens[i];
      const subcommand = level.find((candidate) => candidate.name === token);
      const option = valueOptionOf(token);
      if (subcommand) {
        path.push(token);
        level = subcommand.subcommands ?? [];
      } else if (option && i + 1 < tokens.length) {
        moved.set(option.name, [token, tokens[i + 1]]);
        i++;
      } else {
        break;
      }
    }

    // Nothing was moved, or no subcommand was reached: leave the input alone
    if (!moved.size || path.length === 1) return tokens;
    return [...path, ...[...moved.values()].flat(), ...tokens.slice(i)];
  };

/** A subcommand and the ones under it */
interface SubcommandTree {
  readonly name: string;
  readonly subcommands?: readonly SubcommandTree[];
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  describe("utils/command-options", () => {
    const hoist = hoistParentOptionsWith([
      { name: "url", short: "u", takeValue: true },
      { name: "help", short: "h" },
    ])([
      { name: "confirm" },
      { name: "program", subcommands: [{ name: "show" }, { name: "close" }] },
    ]);

    it("moves an option before the subcommand behind it", () => {
      expect(hoist(["solana", "-u", "d", "confirm", "sig"])).toEqual([
        "solana",
        "confirm",
        "-u",
        "d",
        "sig",
      ]);
    });

    it("moves an option between two levels of subcommand", () => {
      expect(
        hoist(["solana", "program", "--url", "d", "show", "--buffers"])
      ).toEqual(["solana", "program", "show", "--url", "d", "--buffers"]);
    });

    it("keeps an option that already follows the subcommand", () => {
      const tokens = ["solana", "confirm", "-u", "d", "sig"];

      expect(hoist(tokens)).toEqual(tokens);
    });

    it("leaves the input when no subcommand follows the option", () => {
      const tokens = ["solana", "-u", "d", "balance"];

      expect(hoist(tokens)).toEqual(tokens);
    });

    it("keeps the last value of an option given twice", () => {
      expect(
        hoist(["solana", "-u", "d", "--url", "t", "confirm", "sig"])
      ).toEqual(["solana", "confirm", "--url", "t", "sig"]);
    });

    it("leaves an option without a value where it is", () => {
      const tokens = ["solana", "-u"];

      expect(hoist(tokens)).toEqual(tokens);
    });
  });
}
