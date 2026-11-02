// @ts-check
/* eslint-disable no-template-curly-in-string -- the placeholders are the point */
// The sources the deployment offers the assistant: MCP servers and skills, one
// list. `composeCatalogue` (`shared/lib/catalogue/compose.mjs`) fills each
// `${NAME}` from the environment and leaves out an entry whose variable is
// unset, which is how an operator turns one on; `SOURCES` replaces the list.
// Each kind's fields are its slice's to check: `validateServers` in
// `features/mcp`, `validateSkills` in `features/skills`.

/** @typedef {{ kind: "mcp" | "skill", id: string, name: string, signedIn?: boolean } & Record<string, unknown>} CatalogueEntry */

/** @type {readonly CatalogueEntry[]} */
export const SOURCES_CATALOGUE = [
  {
    kind: "mcp",
    id: "solana",
    name: "Solana Developer MCP",
    url: "https://mcp.solana.com/mcp",
  },
  {
    kind: "mcp",
    id: "explorer",
    name: "Solana Explorer MCP",
    url: "${MCP_EXPLORER_URL:-https://explorer.solana.com/mcp}",
    headers: {
      // Explorer gates on MCP_ACCESS_KEYS when its deployment sets them
      authorization: "Bearer ${MCP_EXPLORER_TOKEN:-}",
    },
    // Sent only when set, for an Explorer deployment behind bot protection
    protection: { provider: "vercel", secret: "${MCP_EXPLORER_BYPASS:-}" },
  },

  {
    kind: "skill",
    id: "playground-env",
    name: "Playground build environment",
    description:
      "What this environment can actually compile: anchor-lang 0.29, " +
      "solana-program 1.16, the crate whitelist, TypeScript-only tests. " +
      "Load this before proposing a fix, and prefer it over any other " +
      "source when they disagree about versions.",
    // The text ships in the browser bundle; the catalogue only offers it
    source: { type: "bundled" },
  },
  {
    kind: "skill",
    id: "solana-dev",
    name: "Official Solana developer skill",
    description:
      "The Solana Foundation's own skill (solana-foundation/solana-dev-skill): " +
      "common errors, security, testing, Anchor and @solana/kit references. " +
      "Teaches current versions, so check it against playground-env before " +
      "proposing code for this environment.",
    source: {
      type: "remote",
      baseUrl:
        "https://raw.githubusercontent.com/solana-foundation/" +
        "solana-dev-skill/main/skills/solana-dev/",
      entry: "SKILL.md",
    },
  },
  // A community skill is listed only when it meets the rule in `docs/agent-sources-and-tools.md`, "Community skills"
  {
    kind: "skill",
    id: "surfpool",
    name: "Surfpool local network",
    description:
      "Load when the user runs Surfpool on their machine with the Playground's endpoint set to localhost:8899: " +
      "mainnet forking and the surfnet_* RPC cheatcodes. Its CLI, runbooks, and anchor test parts do not run in " +
      "the Playground, so playground-env wins where they disagree.",
    source: {
      type: "remote",
      baseUrl:
        "https://raw.githubusercontent.com/sendaifun/skills/" +
        "72ef2aa814cca4662341bfcdc01cdc288e9bb502/skills/surfpool/",
      entry: "SKILL.md",
    },
    enabled: false,
    community: { repo: "sendaifun/skills" },
  },
];
