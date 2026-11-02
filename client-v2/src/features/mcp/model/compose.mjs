// @ts-check
// The gateway's server list: the catalogue's `mcp` entries, composed for one
// caller and checked by the rules the browser's editor applies.

import { composeCatalogue } from "../../../shared/lib/catalogue/compose.mjs";
import { isRemoteUrl, validateServers } from "./entry.mjs";

/** @typedef {import("./types").McpServerEntry} McpServerEntry */

/**
 * The servers the gateway offers this caller.
 *
 * @param {object} input
 * @param {import("../../../shared/lib/catalogue/compose.mjs").Env} input.env what placeholders are filled from
 * @param {string} [input.override] `SOURCES`, which replaces the catalogue
 * @param {boolean} input.signedIn whether the caller may see `signedIn` entries
 * @returns {McpServerEntry[]} enabled entries only, in the browser's format
 * @throws what {@link composeCatalogue} throws, and when an entry fails `validateServers` or has a relative url
 */
export const composeServers = ({ env, override, signedIn }) => {
  const validated = validateServers(
    composeCatalogue({ env, override, signedIn }).mcp
  );
  // A relative url is this site's gateway to the browser; the gateway has no base to resolve it against
  const relative = validated.find((server) => !isRemoteUrl(server.url));
  if (relative) {
    throw new Error(
      `${override === undefined ? "SOURCES_CATALOGUE" : "SOURCES"}: server "${
        relative.id
      }" needs an https:// url; a relative url works only in the browser's list.`
    );
  }
  return validated.filter((server) => server.enabled);
};
