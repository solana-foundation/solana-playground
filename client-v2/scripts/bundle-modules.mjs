// The module list craco.config.js writes into build/ and bundle-modules.build-test.mjs checks for test-only code
export const MODULES_FILE = "bundle-modules.json";

// webpack names a module by its path from client-v2, so `./src/` is ours and a package sits under any `node_modules/`
const TEST_ONLY = [
  /^\.\/src\/test-utils\//,
  /\/node_modules\/(vitest|@vitest\/[^/]+)\//,
];

/**
 * webpack's `stats.toJson` modules as `{ name, size, chunks }`, nested modules included: in production a module
 * concatenated into another appears only inside it, and takes its chunks from it. Filtered groups have no name and go.
 */
export const slimModules = (modules, parentChunks = []) =>
  modules
    .filter(({ type }) => type === "module")
    .flatMap(({ name, size, chunks, modules: nested = [] }) => {
      const own = chunks?.length ? chunks : parentChunks;
      return [{ name, size, chunks: own }, ...slimModules(nested, own)];
    });

/** Names of the modules under `src/test-utils/` or from `vitest` or `@vitest/*`, sorted and without repeats */
export const offendingModules = (modules) =>
  [
    ...new Set(
      modules
        .map(({ name }) => name)
        .filter((name) => TEST_ONLY.some((pattern) => pattern.test(name)))
    ),
  ].sort();
