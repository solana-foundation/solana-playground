/** The tool the guide's commands are for */
export type CliTool = "solana" | "anchor";

/** The cluster the guide deploys to */
export type CliCluster = "devnet" | "mainnet";

/** The guide's cluster for Playground's, or `undefined` for one it has no line for */
export const cliClusterOf = (
  cluster: string | null
): CliCluster | undefined => {
  if (cluster === "devnet") return "devnet";
  if (cluster === "mainnet-beta") return "mainnet";
  return undefined;
};

/** The `--url` the Solana CLI takes for each cluster */
const SOLANA_URL: Record<CliCluster, string> = {
  devnet: "devnet",
  mainnet: "mainnet-beta",
};

/**
 * The commands that deploy `<name>.so` with `<name>-keypair.json`, run from
 * the folder both were saved to. `anchor deploy` deploys what sits in
 * `target/deploy/` under the crate's name, so Anchor's path copies both files
 * there first, from an Anchor workspace whose program has the same name.
 */
export const deployCommands = (p: {
  tool: CliTool;
  cluster: CliCluster;
  name: string;
}): string[] => {
  const so = `${p.name}.so`;
  const keypair = `${p.name}-keypair.json`;
  if (p.tool === "solana") {
    return [
      `solana program deploy ${so} --program-id ${keypair} --url ${
        SOLANA_URL[p.cluster]
      }`,
    ];
  }
  return [
    // A workspace never built has no target/deploy yet, and cp needs it
    `mkdir -p target/deploy && cp ${so} ${keypair} target/deploy/`,
    `anchor deploy --provider.cluster ${p.cluster}`,
  ];
};

/**
 * The RPC the Program Metadata CLI writes to. Its `--rpc` takes a URL, not a
 * cluster name, and without it the CLI uses the Solana config's, which may
 * not be the cluster step 3 deployed to.
 */
const RPC_URL: Record<CliCluster, string> = {
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

/** What a command block of step 3.1 is for */
export type IdlCommandKind = "program-metadata" | "anchor";

/** One command block of step 3.1 */
export interface IdlCommand {
  kind: IdlCommandKind;
  lines: string[];
}

/** What a command shows in place of a program id the project does not have */
export const PROGRAM_ID_PLACEHOLDER = "<program-id>";

/**
 * The commands that upload `<name>.json` as the program's IDL, run from the
 * folder it was saved to. Program Metadata's canonical IDL, the one Explorer
 * reads, comes first for every tool; Anchor adds `anchor idl init`, which
 * before Anchor 1.0 writes the legacy Anchor IDL account. The first signs
 * with the Solana CLI wallet, `anchor idl init` with Anchor's provider wallet:
 * each the one its tool deployed with in step 3, so the upgrade authority.
 */
export const idlCommands = (p: {
  tool: CliTool;
  cluster: CliCluster;
  name: string;
  programId: string | null;
}): IdlCommand[] => {
  const idl = `${p.name}.json`;
  const id = p.programId ?? PROGRAM_ID_PLACEHOLDER;
  const commands: IdlCommand[] = [
    {
      kind: "program-metadata",
      lines: [
        `npx @solana-program/program-metadata@latest write idl ${id} ${idl} --rpc ${
          RPC_URL[p.cluster]
        }`,
      ],
    },
  ];
  if (p.tool === "anchor") {
    commands.push({
      kind: "anchor",
      lines: [
        `anchor idl init -f ${idl} ${id} --provider.cluster ${p.cluster}`,
      ],
    });
  }
  return commands;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/cli-deploy/model/commands", () => {
    it("gives the Solana CLI one command per cluster", () => {
      expect(
        deployCommands({ tool: "solana", cluster: "devnet", name: "hello" })
      ).toEqual([
        "solana program deploy hello.so --program-id hello-keypair.json --url devnet",
      ]);
      expect(
        deployCommands({ tool: "solana", cluster: "mainnet", name: "hello" })
      ).toEqual([
        "solana program deploy hello.so --program-id hello-keypair.json --url mainnet-beta",
      ]);
    });

    it("copies into target/deploy before anchor deploy", () => {
      expect(
        deployCommands({ tool: "anchor", cluster: "mainnet", name: "hello" })
      ).toEqual([
        "mkdir -p target/deploy && cp hello.so hello-keypair.json target/deploy/",
        "anchor deploy --provider.cluster mainnet",
      ]);
    });

    it("uploads the IDL through Program Metadata on both clusters", () => {
      const id = "6PNd3SLJU8V6mqVmDNaV6x2UR6A8ZedA3p5FPrBjAVkj";
      expect(
        idlCommands({
          tool: "solana",
          cluster: "devnet",
          name: "hello",
          programId: id,
        })
      ).toEqual([
        {
          kind: "program-metadata",
          lines: [
            `npx @solana-program/program-metadata@latest write idl ${id} hello.json --rpc https://api.devnet.solana.com`,
          ],
        },
      ]);
      expect(
        idlCommands({
          tool: "solana",
          cluster: "mainnet",
          name: "hello",
          programId: id,
        })[0].lines
      ).toEqual([
        `npx @solana-program/program-metadata@latest write idl ${id} hello.json --rpc https://api.mainnet-beta.solana.com`,
      ]);
    });

    it("adds anchor idl init below Program Metadata for Anchor", () => {
      const id = "6PNd3SLJU8V6mqVmDNaV6x2UR6A8ZedA3p5FPrBjAVkj";
      const anchor = idlCommands({
        tool: "anchor",
        cluster: "mainnet",
        name: "hello",
        programId: id,
      });
      expect(anchor.map((c) => c.kind)).toEqual(["program-metadata", "anchor"]);
      expect(anchor[1].lines).toEqual([
        `anchor idl init -f hello.json ${id} --provider.cluster mainnet`,
      ]);
    });

    it("leaves a placeholder without a program id", () => {
      const lines = idlCommands({
        tool: "anchor",
        cluster: "devnet",
        name: "hello",
        // eslint-disable-next-line unicorn/no-null -- a project never deployed
        programId: null,
      }).flatMap((c) => c.lines);
      expect(lines.every((l) => l.includes(" <program-id> "))).toBe(true);
    });

    it("maps only devnet and mainnet-beta to a guide cluster", () => {
      expect(cliClusterOf("devnet")).toBe("devnet");
      expect(cliClusterOf("mainnet-beta")).toBe("mainnet");
      expect(cliClusterOf("localnet")).toBeUndefined();
      // eslint-disable-next-line unicorn/no-null -- the guide's cluster prop is `null` until read
      expect(cliClusterOf(null)).toBeUndefined();
    });
  });
}
