// A file of its own: it stubs `../../utils`, which `solana.ts` reaches the
// terminal, settings and wallet through, and nothing else here wants that.
import { describe, expect, it, vi } from "vitest";

import { TerminalLineError } from "../../utils/terminal/line-error";
import { solana } from "./solana";

vi.mock("../../utils", () => ({
  PgCommon: { sleep: vi.fn() },
  PgSettings: {
    connection: { endpoint: "http://localhost:8899", commitment: "confirmed" },
  },
  PgTerminal: {
    println: vi.fn(),
    printlnBuffersTable: vi.fn(),
    warning: vi.fn(),
    formatList: vi.fn(),
  },
  PgWallet: { current: undefined },
}));
vi.mock("../checks", () => ({ checkPgWallet: vi.fn() }));

interface Node {
  name: string;
  options?: { name: string; short?: string | boolean; takeValue?: true }[];
  subcommands?: Node[];
  handle?: (input: unknown) => Promise<unknown>;
}

const leavesOf = (node: Node): Node[] =>
  node.subcommands ? node.subcommands.flatMap(leavesOf) : [node];

describe("commands/solana/solana", () => {
  const leaves = leavesOf(solana as Node);

  it("declares -u on every subcommand that runs, which hoisting needs", () => {
    expect(leaves.map((leaf) => leaf.name).sort()).toEqual([
      "close",
      "confirm",
      "show",
    ]);
    for (const leaf of leaves) {
      const url = leaf.options?.find((option) => option.name === "url");
      expect(url?.short).toBe("u");
      expect(url?.takeValue).toBe(true);
    }
  });

  it("refuses a -u value that is neither a moniker nor an http(s) URL, asking nothing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const confirm = leaves.find((leaf) => leaf.name === "confirm");

    await expect(
      confirm?.handle?.({ args: { signature: "x" }, options: { url: "dev" } })
    ).rejects.toBeInstanceOf(TerminalLineError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
