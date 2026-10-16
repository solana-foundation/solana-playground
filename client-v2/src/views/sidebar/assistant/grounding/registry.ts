import playgroundEnvSkill from "../content/playground-env.skill.md";
import type { McpServerEntry, SkillEntry } from "./types";

/**
 * The skills the panel offers.
 *
 * Adding one is a single entry here — the tools, the prompt catalogue and the
 * picker all read this list.
 */
export const SKILLS: SkillEntry[] = [
  {
    id: "playground-env",
    name: "Playground build environment",
    description:
      "What this environment can actually compile: anchor-lang 0.29, " +
      "solana-program 1.16, the crate whitelist, TypeScript-only tests. " +
      "Load this before proposing a fix, and prefer it over any other " +
      "source when they disagree about versions.",
    source: { type: "bundled", content: playgroundEnvSkill },
  },
  {
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
];

/**
 * Extra MCP servers, added from the client.
 *
 * **Not the source of truth.** The gateway (`api/mcp.mjs`) owns the list and
 * the panel asks it at startup, so enabling an upstream is a deploy plus an
 * env var rather than a client change — that is how an operator turns Explorer
 * on without shipping anything, and why its absence from the panel means the
 * server has no bypass configured.
 *
 * This list is only for servers wanted *in addition*: something CORS-open a
 * page can reach directly, or an `executor: "server"` entry to route through
 * Anthropic's connector instead. Empty by default, and deliberately not a
 * mirror of what the gateway serves — two lists would disagree.
 */
export const LOCAL_MCP_SERVERS: McpServerEntry[] = [];

/** Skills that are on unless the user turns them off */
export const DEFAULT_SKILL_IDS = SKILLS.map((skill) => skill.id);

export const findSkill = (id: string) => SKILLS.find((s) => s.id === id);
