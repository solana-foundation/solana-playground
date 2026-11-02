// @ts-check
// The skills route's list: the catalogue's `skill` entries, composed for one
// caller and checked by this slice's rules.

import { composeCatalogue } from "../../../shared/lib/catalogue/compose.mjs";
import { validateSkills } from "./entry.mjs";

/**
 * The skills the deployment offers this caller, switched-off ones included.
 *
 * @param {object} input
 * @param {import("../../../shared/lib/catalogue/compose.mjs").Env} input.env what placeholders are filled from
 * @param {string} [input.override] `SOURCES`, which replaces the catalogue
 * @param {boolean} input.signedIn whether the caller may see `signedIn` entries
 * @returns {import("./types").ListedSkill[]}
 * @throws what {@link composeCatalogue} and {@link validateSkills} throw
 */
export const composeSkills = ({ env, override, signedIn }) =>
  validateSkills(composeCatalogue({ env, override, signedIn }).skill);
