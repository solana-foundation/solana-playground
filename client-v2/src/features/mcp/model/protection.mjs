// @ts-check
// Bot-protection bypasses, by provider. An entry names its provider and its
// secret; how the secret travels is the provider's row here, so a server that
// moves off Vercel is a new row, not a change to the gateway or the browser.

/**
 * Where a provider takes its bypass secret: `header` for the gateway, which
 * calls from the server; `query` for the browser, where a custom header must
 * pass the upstream's CORS preflight and a query parameter need not.
 *
 * @typedef {{ header: string, query: string }} ProtectionScheme
 */

/** @typedef {import("./types").McpProtection} McpProtection */

/** @type {Readonly<Record<string, ProtectionScheme>>} */
export const PROTECTION_PROVIDERS = Object.freeze({
  // https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
  vercel: {
    header: "x-vercel-protection-bypass",
    query: "x-vercel-protection-bypass",
  },
});

/** @param {string} provider */
export const isProtectionProvider = (provider) =>
  Object.prototype.hasOwnProperty.call(PROTECTION_PROVIDERS, provider);

/**
 * The headers that carry an entry's bypass, for a caller on the server.
 *
 * @param {McpProtection | undefined} protection
 * @returns {Record<string, string>} empty when the entry has no protection
 */
export const protectionHeaders = (protection) =>
  protection
    ? { [PROTECTION_PROVIDERS[protection.provider].header]: protection.secret }
    : {};

/**
 * The query parameters that carry an entry's bypass, for the browser.
 *
 * @param {McpProtection | undefined} protection
 * @returns {Record<string, string>} empty when the entry has no protection
 */
export const protectionQuery = (protection) =>
  protection
    ? { [PROTECTION_PROVIDERS[protection.provider].query]: protection.secret }
    : {};
