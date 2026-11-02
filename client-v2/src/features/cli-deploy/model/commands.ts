/** The tool the guide's commands are for */
export type CliTool = "solana" | "anchor";

/** The cluster the guide deploys to */
export type CliCluster = "devnet" | "mainnet";

/** The guide's cluster for Playground's, or `null` for one it has no line for */
export const cliClusterOf = (cluster: string | null): CliCluster | null => {
  if (cluster === "devnet") return "devnet";
  if (cluster === "mainnet-beta") return "mainnet";
  return null;
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

    it("maps only devnet and mainnet-beta to a guide cluster", () => {
      expect(cliClusterOf("devnet")).toBe("devnet");
      expect(cliClusterOf("mainnet-beta")).toBe("mainnet");
      expect(cliClusterOf("localnet")).toBeNull();
      expect(cliClusterOf(null)).toBeNull();
    });
  });
}
