// @ts-check
/* eslint-disable no-template-curly-in-string -- the placeholders are the point */
// The sources the deployment offers the assistant: MCP servers and skills, one
// list. `composeCatalogue` (`shared/lib/catalogue/compose.mjs`) fills each
// `${NAME}` from the environment and leaves out an entry whose variable is
// unset, which is how an operator turns one on; `SOURCES` replaces the list.
// Each kind's fields are its slice's to check: `validateServers` in
// `features/mcp`, `validateSkills` in `features/skills`.

/** @typedef {{ kind: "mcp" | "skill", id: string, name: string, signedIn?: boolean } & Record<string, unknown>} CatalogueEntry */

/** The commit solana.com/skills pins for most of sendaifun/skills */
const SENDAI_COMMIT = "72ef2aa814cca4662341bfcdc01cdc288e9bb502";

/**
 * A skill from solana.com/skills, read from `repo` at `commit` so its owner cannot change what the model reads
 * without a change here. `path` is the skill's folder, empty at the repository root.
 *
 * @param {{ id: string, name: string, description: string, repo: string, commit: string, path: string, entry?: string }} skill
 * @returns {CatalogueEntry}
 */
const communitySkill = ({
  id,
  name,
  description,
  repo,
  commit,
  path,
  entry = "SKILL.md",
}) => ({
  kind: "skill",
  id,
  name,
  description,
  source: {
    type: "remote",
    baseUrl: `https://raw.githubusercontent.com/${repo}/${commit}/${
      path ? `${path}/` : ""
    }`,
    entry,
  },
  enabled: false,
  community: { repo },
});

/**
 * A skill in sendaifun/skills, whose folder is `skills/<id>` unless `folder` says otherwise.
 *
 * @param {string} id
 * @param {string} name
 * @param {string} description
 * @param {{ folder?: string, commit?: string }} [options]
 */
const sendaiSkill = (
  id,
  name,
  description,
  { folder = id, commit = SENDAI_COMMIT } = {}
) =>
  communitySkill({
    id,
    name,
    description,
    repo: "sendaifun/skills",
    commit,
    path: `skills/${folder}`,
  });

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

  sendaiSkill(
    "birdeye",
    "Birdeye",
    "Birdeye API for token prices, OHLCV charts, holder and trader data, wallet portfolios, and live price streams.",
    { commit: "ff8d226b5a99615d9bed24c549631ba791dec529" }
  ),
  sendaiSkill(
    "coingecko",
    "CoinGecko",
    "CoinGecko API for Solana token prices, DEX pool data, OHLCV charts, and trades."
  ),
  sendaiSkill(
    "debridge",
    "deBridge",
    "deBridge SDK for bridging tokens and passing messages between Solana and EVM chains."
  ),
  sendaiSkill(
    "dflow",
    "DFlow",
    "DFlow trading protocol: spot swaps, prediction markets, the Swap and Metadata APIs, and WebSocket streams."
  ),
  communitySkill({
    id: "dflow-phantom-connect",
    name: "Phantom Connect with DFlow",
    description:
      "Wallet-connected apps with the Phantom Connect SDKs for React, React Native, and plain JavaScript, with DFlow swaps and Proof KYC.",
    repo: "DFlowProtocol/dflow_phantom-connect-skill",
    commit: "a0a06f522b51893cbebe4f03597538093c668e4c",
    path: "skill",
  }),
  sendaiSkill(
    "helius",
    "Helius",
    "Helius infrastructure: transaction sending, the DAS API, WebSockets and Laserstream, webhooks, and priority fees."
  ),
  communitySkill({
    id: "jupiter",
    name: "Jupiter",
    description:
      "Jupiter APIs (Swap, Lend, Perps, Trigger, Recurring, Price, and more): which endpoint to use and how to handle its errors.",
    repo: "jup-ag/agent-skills",
    commit: "35f50e9f00288cfddbbecc31c9e97d036df8541a",
    path: "skills/integrating-jupiter",
  }),
  sendaiSkill(
    "kamino",
    "Kamino",
    "Kamino Finance SDKs for lending, borrowing, automated liquidity strategies, leverage, and the Scope oracle."
  ),
  sendaiSkill(
    "light-protocol",
    "Light Protocol (SendAI)",
    "Light Protocol ZK Compression and the Light Token program, through the TypeScript SDK and JSON RPC methods."
  ),
  communitySkill({
    id: "light-rent-free",
    name: "Light Protocol rent-free development",
    description:
      "Light Protocol's own guide to rent-free token, mint, and PDA accounts in clients and Anchor, native Rust, or Pinocchio programs.",
    repo: "Lightprotocol/skills",
    commit: "e149bdca6ce440fb5a3421ae684d553fbd21ba0d",
    path: "skills/agent-dev-orchestrator",
    entry: "skill.md",
  }),
  sendaiSkill(
    "lulo",
    "Lulo",
    "Lulo lending aggregator API for deposits, withdrawals, balances, and yield across Solana lending protocols."
  ),
  communitySkill({
    id: "magicblock",
    name: "MagicBlock Ephemeral Rollups",
    description:
      "MagicBlock Ephemeral Rollups: delegating accounts, cranks, verifiable randomness, and Anchor and TypeScript integration.",
    repo: "magicblock-labs/magicblock-dev-skill",
    commit: "5546320bff3e544825d9f678b5458057e1a653f3",
    path: "skill",
  }),
  communitySkill({
    id: "metaplex-foundation",
    name: "Metaplex (Metaplex Foundation)",
    description:
      "Metaplex Foundation's own guide to Token Metadata, Core, Bubblegum, Candy Machine, Genesis, and the mplx CLI.",
    repo: "metaplex-foundation/skill",
    commit: "9e12103401d9813666da451babf433c8da647d16",
    path: "skills/metaplex",
  }),
  // solana.com/skills lists two Metaplex skills, so each id names its publisher
  sendaiSkill(
    "metaplex-sendai",
    "Metaplex (SendAI)",
    "Metaplex NFTs and digital assets: Core, Token Metadata, Bubblegum, Candy Machine, the DAS API, and Umi.",
    { folder: "metaplex" }
  ),
  sendaiSkill(
    "meteora",
    "Meteora",
    "Meteora SDKs for DLMM and DAMM pools, dynamic bonding curves, Alpha Vaults, and token launches."
  ),
  communitySkill({
    id: "octav",
    name: "Octav portfolio API",
    description:
      "Octav API for multi-chain wallet balances, transaction history, DeFi positions, and portfolio snapshots.",
    repo: "Octav-Labs/octav-api-skill",
    commit: "eba042fdada9167334dc40fb46ff3a05a4ffe8a0",
    path: "",
  }),
  sendaiSkill(
    "orca",
    "Orca",
    "Orca Whirlpools SDK for concentrated-liquidity swaps, positions, pool creation, and fee collection."
  ),
  sendaiSkill(
    "pinocchio-development",
    "Pinocchio programs",
    "Solana programs with Pinocchio, the zero-dependency, zero-copy framework: account checks, CPIs, and moving from Anchor."
  ),
  communitySkill({
    id: "pnp-markets",
    name: "PNP prediction markets",
    description:
      "PNP protocol for creating, trading, and settling permissionless prediction markets with custom oracles.",
    repo: "pnp-protocol/solana-skill",
    commit: "54d164c1f1182a0674c9e57b24a82cf18e60e500",
    path: "",
  }),
  sendaiSkill(
    "pumpfun",
    "Pump.fun",
    "Pump.fun token launches on bonding curves, the PumpSwap AMM, and its fees and creator fees."
  ),
  sendaiSkill(
    "pyth",
    "Pyth",
    "Pyth price feeds on Solana: confidence intervals, EMA prices, on-chain CPI, and off-chain fetching."
  ),
  communitySkill({
    id: "quicknode",
    name: "QuickNode",
    description:
      "QuickNode infrastructure: RPC endpoints, Streams, webhooks, the Solana DAS API, Yellowstone gRPC, and add-ons.",
    repo: "quiknode-labs/blockchain-skills",
    commit: "c18430c1aef4a19e88bb21d2947b5c6e9a153576",
    path: "skills/quicknode-skill",
  }),
  sendaiSkill(
    "ranger-finance",
    "Ranger Finance",
    "Ranger Finance SDK for perpetual futures across several Solana perp protocols, with smart order routing."
  ),
  sendaiSkill(
    "raydium",
    "Raydium",
    "Raydium SDK and Trade API for CLMM, CPMM, and AMM pools, LaunchLab launches, farms, and CPI."
  ),
  sendaiSkill(
    "sanctum",
    "Sanctum",
    "Sanctum SDK for liquid staking, swaps between liquid staking tokens, and the Infinity pool."
  ),
  communitySkill({
    id: "solana-anchor",
    name: "Solana and Anchor code (QuickNode)",
    description:
      "Conventions for Anchor programs, Rust crates, and TypeScript clients and tests that keep the code short and free of repetition.",
    repo: "quiknode-labs/solana-anchor-claude-skill",
    commit: "8a865b8d590ea8d9121f8c73e6abf99679f73a6a",
    path: "",
  }),
  communitySkill({
    id: "solana-development",
    name: "Solana programs with Anchor or native Rust",
    description:
      "Writing, testing, and deploying Solana programs with Anchor or native Rust, token operations included.",
    repo: "tenequm/skills",
    commit: "bedc922b6301179fbc2772079692cd3d748762d2",
    path: "skills/solana-development",
  }),
  communitySkill({
    id: "solana-game",
    name: "Solana game development",
    description:
      "Games on Solana with Unity, React Native, and the web: the Solana.Unity SDK, Mobile Wallet Adapter, and NFT systems.",
    repo: "solanabr/solana-game-skill",
    commit: "762b3b28e62b4c6cabc01ae179d316958a852a07",
    path: "skill",
  }),
  sendaiSkill(
    "solana-kit",
    "@solana/kit",
    "The @solana/kit JavaScript SDK: RPC connections, signers, building, signing, and sending transactions, and fetching accounts."
  ),
  sendaiSkill(
    "solana-kit-migration",
    "Moving to @solana/kit",
    "When to use @solana/kit or @solana/web3.js v1, and how APIs map from one to the other."
  ),
  sendaiSkill(
    "squads",
    "Squads",
    "Squads V4 multisig, the Smart Account program, and Grid stablecoin rails."
  ),
  sendaiSkill(
    "surfpool",
    "Surfpool",
    "Surfpool local validator with mainnet forking and cheatcodes, a replacement for solana-test-validator."
  ),
  sendaiSkill(
    "switchboard",
    "Switchboard",
    "Switchboard oracles on Solana: price feeds, on-demand data, VRF randomness, and Surge streaming."
  ),
  sendaiSkill(
    "vulnhunter",
    "VulnHunter",
    "Security review that finds dangerous APIs, error-prone patterns, and variants of a known vulnerability across a codebase."
  ),
  sendaiSkill(
    "zz-code-recon",
    "Code recon for audits",
    "Maps a codebase's architecture and trust boundaries before a security audit."
  ),
];
