// The module list craco.config.js writes and bundle-modules.build-test.mjs checks for test-only code
import path from "node:path";

// Outside build/, so a deployment never serves every module path
export const MODULES_FILE = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "bundle-info",
  "bundle-modules.json"
);

// webpack names a module by its path from client-v2, so `./src/` is ours and a package sits under any `node_modules/`
const TEST_ONLY = [
  /^\.\/src\/test-utils\//,
  /\/node_modules\/(vitest|@vitest\/[^/]+)\//,
];

/**
 * The names of webpack's `stats.toJson` modules, nested modules included: in production a module concatenated into
 * another appears only inside it. Entries of any other `type`, such as the orphan-modules group, are dropped.
 * Throws on a module without a string name, which {@link offendingModules} would pass as clean, and on a dropped entry
 * that holds modules, which the list would lose.
 */
export const slimModules = (modules) =>
  modules.flatMap(({ type, name, modules: nested = [] }) => {
    if (type !== "module") {
      if (nested.length > 0) {
        throw new Error(
          `a "${type}" entry in webpack's stats.toJson({ modules: true }) holds modules; the module list would lose them`
        );
      }
      return [];
    }
    if (typeof name !== "string") {
      throw new Error(
        "a module in webpack's stats.toJson({ modules: true }) has no string name; the module list cannot name a test helper"
      );
    }
    return [name, ...slimModules(nested)];
  });

/** The module names under `src/test-utils/` or from `vitest` or `@vitest/*`, sorted and without repeats */
export const offendingModules = (names) =>
  [
    ...new Set(names.filter((name) => TEST_ONLY.some((p) => p.test(name)))),
  ].sort();

const CONCATENATED = /^(.+) \+ \d+ modules$/;

/** The root of each concatenated module (`<root> + N modules`) missing from `names` by its own name, so its nested modules are missing too */
export const unlistedConcatenatedRoots = (names) => {
  const listed = new Set(names);
  return names
    .map((name) => name.match(CONCATENATED)?.[1])
    .filter((root) => root !== undefined && !listed.has(root));
};
