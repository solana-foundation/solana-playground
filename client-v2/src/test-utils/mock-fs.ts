import { PgCommon } from "../utils/common";

/**
 * An in-memory stand-in for `PgFs`, for tests that run under jsdom.
 *
 * `PgFs` wraps lightning-fs, which constructs an IndexedDB store the moment
 * the module is imported. Under jsdom that throws before any spy could be
 * installed, so the module is replaced outright. `setupTests.ts` already does
 * that for every test file; no test needs its own `vi.mock` for it.
 *
 * The real filesystem round trip is covered by the browser tests in `e2e/`.
 */
export const mockFsModule = () => {
  const files = new Map<string, string>();

  const events = { ON_DID_WRITE_FILE: "pgfsondidwritefile" };

  /**
   * Drop a trailing slash, which lightning-fs tolerates on a directory and a
   * `startsWith` over a flat map does not. `PgExplorer` appends one to every
   * directory path it builds, so without this the explorer reads as empty
   * everywhere it looks.
   */
  const dir = (path: string) => path.replace(/\/+$/, "");

  const PgFs = {
    /** Test-only handle, for asserting on or corrupting what is stored */
    __files: files,

    events,

    onDidWriteFile(cb: (path: string, data: string) => unknown) {
      return PgCommon.onDidChange(
        events.ON_DID_WRITE_FILE,
        ({ path, data }: { path: string; data: string }) => cb(path, data)
      );
    },

    async writeFile(path: string, data: string) {
      files.set(path, data);
      // Dispatched here as well, because what listens for it is the only
      // thing that uploads the three workspace files written this way
      PgCommon.createAndDispatchCustomEvent(events.ON_DID_WRITE_FILE, {
        path,
        data,
      });
    },

    async readToString(path: string) {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },

    async readToJSON(path: string) {
      return JSON.parse(await this.readToString(path));
    },

    async readToJSONOrDefault(path: string, defaultValue: unknown) {
      try {
        return await this.readToJSON(path);
      } catch {
        return defaultValue;
      }
    },

    async removeFile(path: string) {
      files.delete(path);
    },

    async rename(oldPath: string, newPath: string) {
      // A directory may come with its trailing slash, as the explorer's
      // canonical paths have it
      oldPath = oldPath.replace(/\/+$/, "");
      newPath = newPath.replace(/\/+$/, "");
      for (const [path, content] of [...files.entries()]) {
        if (path !== oldPath && !path.startsWith(oldPath + "/")) continue;
        files.delete(path);
        files.set(newPath + path.slice(oldPath.length), content);
      }
    },

    async createDir() {},

    async exists(path: string) {
      return (
        files.has(path) ||
        [...files.keys()].some((key) => key.startsWith(dir(path) + "/"))
      );
    },

    /**
     * Enough of `stat` for a directory walk: a path is a directory when
     * anything is stored beneath it. Matches the real thing in throwing for a
     * path that is neither.
     */
    async getMetadata(path: string) {
      const isDirectory = [...files.keys()].some((key) =>
        key.startsWith(dir(path) + "/")
      );
      if (!isDirectory && !files.has(path)) {
        throw new Error(`ENOENT: ${path}`);
      }
      return { isDirectory: () => isDirectory, isFile: () => !isDirectory };
    },

    async removeDir(path: string) {
      for (const key of [...files.keys()]) {
        if (key.startsWith(dir(path))) files.delete(key);
      }
    },

    async readDir(path: string) {
      // Immediate children only, like the real thing -- a recursive walk that
      // was handed whole subpaths here would look like it worked while never
      // actually recursing
      const parent = dir(path);
      const names = new Set(
        [...files.keys()]
          .filter((key) => key.startsWith(parent + "/"))
          .map((key) => key.slice(parent.length + 1).split("/")[0])
      );
      // Matches the real thing: a directory that does not exist throws rather
      // than reading as empty, which is what `threadIds` relies on
      if (!names.size) throw new Error(`ENOENT: ${path}`);
      return [...names];
    },

    async flush() {},
  };

  return { PgFs };
};
