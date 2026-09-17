/**
 * An in-memory stand-in for `PgFs`, for tests that run under jsdom.
 *
 * `PgFs` wraps lightning-fs, which constructs an IndexedDB store the moment
 * the module is imported. Under jsdom that throws before any spy could be
 * installed, so the module has to be replaced outright:
 *
 * ```ts
 * jest.mock("../../../utils/explorer/fs", () =>
 *   require("../../../test-utils/mock-fs").mockFsModule()
 * );
 * ```
 *
 * A `jest.mock` factory is hoisted above the imports, which is why it must
 * `require` this rather than close over anything.
 *
 * The real filesystem round trip is covered by the browser tests in `e2e/`.
 */
export const mockFsModule = () => {
  const files = new Map<string, string>();

  const PgFs = {
    /** Test-only handle, for asserting on or corrupting what is stored */
    __files: files,

    async writeFile(path: string, data: string) {
      files.set(path, data);
    },

    async readToString(path: string) {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },

    async removeFile(path: string) {
      files.delete(path);
    },

    async createDir() {},

    async removeDir(dir: string) {
      for (const path of [...files.keys()]) {
        if (path.startsWith(dir)) files.delete(path);
      }
    },

    async readDir(dir: string) {
      const names = [...files.keys()]
        .filter((path) => path.startsWith(dir + "/"))
        .map((path) => path.slice(dir.length + 1));
      // Matches the real thing: a directory that does not exist throws rather
      // than reading as empty, which is what `threadIds` relies on
      if (!names.length) throw new Error(`ENOENT: ${dir}`);
      return names;
    },

    async flush() {},
  };

  return { PgFs };
};
