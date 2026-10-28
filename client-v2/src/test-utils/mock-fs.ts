import { PgCommon } from "../utils/common";
import type { PgFs as RealPgFs } from "../utils/explorer/fs";

/**
 * An in-memory stand-in for `PgFs`, for tests that run under jsdom.
 *
 * `PgFs` wraps lightning-fs, which constructs an IndexedDB store the moment
 * the module is imported. Under jsdom that throws before any spy could be
 * installed, so the module is replaced outright. `setupTests.ts` already does
 * that for every test file; no test needs its own `vi.mock` for it.
 *
 * The members it provides are checked against the real ones' signatures
 * (`checkedAs` below), and every path goes through
 * `PgExplorer.convertToFullPath` as the real one's does, so a relative path
 * lands under the open workspace. The real filesystem round trip is covered
 * by the browser tests in `e2e/`.
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

  /**
   * `PgFs`'s own path resolution. Imported on call: the explorer imports this
   * module's stand-in while it loads, so a static import would be a cycle.
   */
  const full = async (path: string) =>
    (await import("../utils/explorer/explorer")).PgExplorer.convertToFullPath(
      path
    );

  /** A filesystem error carrying lightning-fs's `code`, which callers branch on */
  const fsError = (code: "ENOENT" | "ENOTDIR" | "ENOTEMPTY", path: string) =>
    Object.assign(new Error(`${code}: ${path}`), { code });

  /** Whether `key` is `path` itself or lies beneath it */
  const isUnder = (key: string, path: string) =>
    key === path || key.startsWith(path + "/");

  /**
   * The `satisfies` operator, which prettier 2.7 cannot parse: checks the mock
   * against `T` and keeps the mock's own type, `__files` included. Replace it
   * with the operator once prettier is upgraded.
   */
  const checkedAs =
    <T>() =>
    <U extends T>(value: U) =>
      value;

  const PgFs = checkedAs<
    Pick<
      typeof RealPgFs,
      | "events"
      | "onDidWriteFile"
      | "writeFile"
      | "readToString"
      | "readToJSON"
      | "readToJSONOrDefault"
      | "removeFile"
      | "rename"
      | "createDir"
      | "exists"
      | "getMetadata"
      | "removeDir"
      | "readDir"
      | "flush"
    > & { __files: Map<string, string> }
  >()({
    /** Test-only handle, for asserting on or corrupting what is stored */
    __files: files,

    events,

    onDidWriteFile(cb: (path: string, data: string) => unknown) {
      return PgCommon.onDidChange(
        events.ON_DID_WRITE_FILE,
        ({ path, data }: { path: string; data: string }) => cb(path, data)
      );
    },

    async writeFile(
      path: string,
      data: string,
      _opts?: { createParents?: boolean }
    ) {
      path = await full(path);
      files.set(path, data);
      // Dispatched here as well, because what listens for it is the only
      // thing that uploads the three workspace files written this way
      PgCommon.createAndDispatchCustomEvent(events.ON_DID_WRITE_FILE, {
        path,
        data,
      });
    },

    async readToString(path: string) {
      path = await full(path);
      const content = files.get(path);
      if (content === undefined) throw fsError("ENOENT", path);
      return content;
    },

    async readToJSON(path: string) {
      return JSON.parse(await this.readToString(path));
    },

    async readToJSONOrDefault<T>(path: string, defaultValue: T): Promise<T> {
      try {
        return await this.readToJSON(path);
      } catch {
        return defaultValue;
      }
    },

    async removeFile(path: string) {
      files.delete(await full(path));
    },

    async rename(oldPath: string, newPath: string) {
      // A directory may come with its trailing slash, as the explorer's
      // canonical paths have it
      oldPath = dir(await full(oldPath));
      newPath = dir(await full(newPath));
      for (const [path, content] of [...files.entries()]) {
        if (path !== oldPath && !path.startsWith(oldPath + "/")) continue;
        files.delete(path);
        files.set(newPath + path.slice(oldPath.length), content);
      }
    },

    /** A no-op: a directory exists here while anything is stored beneath it */
    async createDir(_path: string, _opts?: { createParents?: boolean }) {},

    async exists(path: string) {
      path = await full(path);
      return (
        files.has(path) ||
        [...files.keys()].some((key) => key.startsWith(dir(path) + "/"))
      );
    },

    /**
     * `stat`, as far as a path tells: a path is a directory when anything is
     * stored beneath it. Matches the real thing in throwing for a path that is
     * neither. Times and ids are fixed; nothing under test reads them.
     */
    async getMetadata(path: string) {
      path = await full(path);
      const isDirectory = [...files.keys()].some((key) =>
        key.startsWith(dir(path) + "/")
      );
      const content = files.get(path);
      if (!isDirectory && content === undefined) {
        throw fsError("ENOENT", path);
      }
      return {
        type: isDirectory ? "dir" : "file",
        mode: isDirectory ? 0o777 : 0o666,
        size: isDirectory ? 0 : content?.length ?? 0,
        ino: 0,
        mtimeMs: 0,
        ctimeMs: 0,
        uid: 1,
        gid: 1,
        dev: 1,
        isDirectory: () => isDirectory,
        isFile: () => !isDirectory,
        isSymbolicLink: () => false,
      } as const;
    },

    /**
     * Like the real thing, refuses a directory with anything in it unless
     * `recursive` is set
     */
    async removeDir(path: string, opts?: { recursive?: boolean }) {
      path = dir(await full(path));
      if (files.has(path)) throw fsError("ENOTDIR", path);
      const under = [...files.keys()].filter((key) => isUnder(key, path));
      if (under.length && !opts?.recursive) {
        throw fsError("ENOTEMPTY", path);
      }
      for (const key of under) files.delete(key);
    },

    async readDir(path: string) {
      path = await full(path);
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
      if (!names.size) throw fsError("ENOENT", path);
      return [...names];
    },

    async flush() {},
  });

  return { PgFs };
};
