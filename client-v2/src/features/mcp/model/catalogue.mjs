// @ts-check
/* eslint-disable no-template-curly-in-string -- the placeholders are the point */
// The MCP servers the gateway can serve, in the browser's entry format plus
// `signedIn`, which withholds an entry from an anonymous caller. A `${NAME}`
// in any string is filled from the environment by `composeServers`, and an
// entry whose variables are unset is left out: that is how an operator turns
// one on. `${NAME:-}` marks a header or query value as optional.
// `MCP_SERVERS` replaces this list with one in the same format.

/** @typedef {import("./types").McpServerEntry & { signedIn?: boolean }} CatalogueEntry */

/** @type {readonly CatalogueEntry[]} */
export const MCP_CATALOGUE = [
  {
    id: "solana",
    name: "Solana Developer MCP",
    url: "https://mcp.solana.com/mcp",
    enabled: true,
  },
  {
    id: "explorer",
    name: "Solana Explorer MCP",
    url: "${MCP_EXPLORER_URL:-https://explorer.solana.com/mcp}",
    enabled: true,
    headers: {
      // Explorer gates on MCP_ACCESS_KEYS when its deployment sets them
      authorization: "Bearer ${MCP_EXPLORER_TOKEN:-}",
    },
    // Sent only when set, for an Explorer deployment behind bot protection
    protection: { provider: "vercel", secret: "${MCP_EXPLORER_BYPASS:-}" },
  },
];
