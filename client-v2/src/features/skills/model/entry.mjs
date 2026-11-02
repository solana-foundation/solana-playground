// @ts-check
// The shape of a skill entry in the catalogue, checked on the server before
// `/api/skills` lists it. `.mjs` so Node imports it directly.

/** @typedef {import("./types").ListedSkill} ListedSkill */

/** The model passes the id to `load_skill`, and the tab builds element ids from it */
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * @param {string} message
 * @returns {never}
 */
const fail = (message) => {
  throw new Error(message);
};

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {ListedSkill["source"]}
 */
const readSource = (value, where) => {
  if (!isObject(value)) fail(`${where}: "source" must be an object.`);
  if (value.type === "bundled") return { type: "bundled" };
  if (value.type !== "remote") {
    fail(`${where}: "source.type" must be "bundled" or "remote".`);
  }
  const { baseUrl, entry } = value;
  // `read_skill_reference` confines a path to the folder `baseUrl` names, which needs the trailing slash
  if (
    typeof baseUrl !== "string" ||
    !baseUrl.startsWith("https://") ||
    !baseUrl.endsWith("/")
  ) {
    fail(`${where}: "source.baseUrl" must be an https:// URL ending in "/".`);
  }
  if (typeof entry !== "string" || !entry.trim()) {
    fail(`${where}: "source.entry" must name the skill's document.`);
  }
  return { type: "remote", baseUrl, entry };
};

/**
 * Check the catalogue's skill entries and fill in their defaults.
 *
 * @param {readonly Record<string, unknown>[]} entries the `skill` entries `composeCatalogue` returned
 * @returns {ListedSkill[]}
 * @throws with a message naming the skill and field at fault
 */
export const validateSkills = (entries) =>
  entries.map((entry) => {
    const { id, name, description, enabled, community } = entry;
    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      fail(
        `Skill "${id}": "id" must be letters, digits, dashes or underscores.`
      );
    }
    const where = `Skill "${id}"`;
    if (typeof name !== "string" || !name.trim()) {
      fail(`${where}: "name" is required.`);
    }
    // The prompt lists every checked skill's description, and the model picks from it
    if (typeof description !== "string" || !description.trim()) {
      fail(`${where}: "description" is required.`);
    }
    if (enabled !== undefined && typeof enabled !== "boolean") {
      fail(`${where}: "enabled" must be true or false.`);
    }
    if (
      community !== undefined &&
      !(isObject(community) && typeof community.repo === "string")
    ) {
      fail(`${where}: "community" must be { "repo": "owner/repo" }.`);
    }

    return {
      id,
      name,
      description,
      source: readSource(entry.source, where),
      enabled: enabled !== false,
      ...(community ? { community: { repo: String(community.repo) } } : {}),
    };
  });
