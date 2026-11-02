/**
 * What this entity offers a server route. The one door into it.
 *
 * `index.ts` is the same registry for the browser; this is its counterpart
 * for `api/*.mjs`, which Vercel executes as plain ESM with no build step.
 * Nothing under `api/` imports it yet: `api/agent.mjs` forwards the tools the
 * browser sends. The skills and MCP servers a deployment offers are
 * `SOURCES_CATALOGUE` (`shared/config/sources.mjs`). `BUILTIN_TOOLS` is declarations, not a
 * provider's wire format: a server that sends them upstream maps them first,
 * and every tool still runs in the browser.
 */
export { BUILTIN_TOOLS } from "./model/registry.mjs";
