/**
 * What this entity offers a server route. The one door into it.
 *
 * `index.ts` is the same registry for the browser; this is its counterpart
 * for `api/*.mjs`, which Vercel executes as plain ESM with no build step.
 * Nothing under `api/` imports it yet: `api/agent.mjs` forwards the tools the
 * browser sends, and `api/mcp.mjs` keeps its own Solana literal, which
 * `DEFAULT_MCP_SERVERS` can replace. `BUILTIN_TOOLS` is declarations, not a
 * provider's wire format: a server that sends them upstream maps them first,
 * and every tool still runs in the browser.
 */
export {
  BUILTIN_TOOLS,
  DEFAULT_MCP_SERVERS,
  SKILL_CATALOGUE,
} from "./model/registry.mjs";
