// The size and count limits a project is held to, read by the explorer, the
// sync client and `PUT /api/projects`. `.mjs` so Node runs it as written, as
// `features/auth/config.mjs` is; `allowJs` lets the browser side import the
// same file rather than restate a figure that must agree on both sides.
//
// A Playground project is an exercise: the largest bundled tutorial holds
// 12.5 KB in 3 files, so these sit far above that and far below the 4.5 MB a
// Vercel Function accepts as a request body.

/** The four limits, in bytes, code points and files */
export const PROJECT_LIMITS = Object.freeze({
  /** A file's content, in UTF-8 bytes (about 3,600 lines of Rust) */
  fileBytes: 128 * 1024,
  /** A file's workspace-relative path, in Unicode code points */
  pathChars: 256,
  /** Every synced file together, generated ones included, in UTF-8 bytes */
  projectBytes: 512 * 1024,
  /** Synced files, not counting `SYNCED_WORKSPACE_FILES` */
  files: 50,
});

/**
 * Workspace files that travel with the code.
 *
 * `program-info.json` carries the program keypair. Syncing it is deliberate:
 * without it the same project deploys to a different address on every device,
 * which is the thing users notice. This is a playground, the keys are
 * playground keys, and the UI says so. The two tutorial files are what let a
 * lesson resume on another device at the page it was left on, rather than at
 * the beginning.
 *
 * `.workspace/metadata.json` -- the open tabs and cursor positions -- is
 * deliberately *not* here. It is rewritten every time a project is opened, so
 * syncing it would make merely looking at a project a change the other device
 * has to reconcile, and two idle browsers would trade conflicts over where the
 * caret was.
 *
 * They count toward the project's size but not its file count: the app writes
 * them, so a user could not remove them to get under the count.
 */
export const SYNCED_WORKSPACE_FILES = [
  ".workspace/program-info.json",
  ".workspace/tutorial-storage.json",
  ".tutorial.json",
];

/**
 * Whether sync carries a workspace-relative path: a user file, or one of
 * `SYNCED_WORKSPACE_FILES`. The rest of `.workspace/` is local state.
 *
 * @param {string} path
 */
export const isSyncedPath = (path) =>
  SYNCED_WORKSPACE_FILES.includes(path) || !path.startsWith(".workspace/");

/**
 * The first limit a project is over, with what is over it: the shape of a
 * limit 413's body.
 *
 * @typedef {{reason: "path-too-long", limit: number, paths: string[]}
 *   | {reason: "file-too-large", limit: number, paths: string[],
 *      sizes: Record<string, number>}
 *   | {reason: "too-many-files", limit: number, count: number}
 *   | {reason: "project-too-large", limit: number, size: number}} LimitExceeded
 */

/** @typedef {LimitExceeded["reason"]} LimitReason */

/** @type {readonly LimitReason[]} */
export const LIMIT_REASONS = [
  "path-too-long",
  "file-too-large",
  "too-many-files",
  "project-too-large",
];

/**
 * The four `LimitExceeded` shapes, built here only, so the client's check and
 * the server's measure send the same fields under the same names.
 */
export const limitExceeded = Object.freeze({
  /** @param {string[]} paths */
  pathTooLong: (paths) => ({
    reason: /** @type {const} */ ("path-too-long"),
    limit: PROJECT_LIMITS.pathChars,
    paths: [...paths].sort(),
  }),
  /** @param {Record<string, number>} sizes the size of each file over */
  fileTooLarge: (sizes) => ({
    reason: /** @type {const} */ ("file-too-large"),
    limit: PROJECT_LIMITS.fileBytes,
    paths: Object.keys(sizes).sort(),
    sizes,
  }),
  /** @param {number} count */
  tooManyFiles: (count) => ({
    reason: /** @type {const} */ ("too-many-files"),
    limit: PROJECT_LIMITS.files,
    count,
  }),
  /** @param {number} size */
  projectTooLarge: (size) => ({
    reason: /** @type {const} */ ("project-too-large"),
    limit: PROJECT_LIMITS.projectBytes,
    size,
  }),
});

/** @param {unknown} value */
const isStringList = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => typeof item === "string");

/** @param {unknown} value */
const isCount = (value) => Number.isInteger(value) && Number(value) >= 0;

/**
 * A limit refusal's body read into a `LimitExceeded`, or `null` when it is
 * not one: the body cap's `too-large`, or a body missing a field its reason
 * needs. Every field is checked and copied, nothing else is, so a body from a
 * server that differs from this client (a long-open tab, a proxy) cannot reach
 * the banner's wording or the limit events with a field they cannot read.
 *
 * `limit` is copied from the body rather than taken from `PROJECT_LIMITS`:
 * the server's figure is the one it refused against.
 *
 * @param {unknown} body
 * @returns {LimitExceeded | null}
 */
export const readLimitExceeded = (body) => {
  if (!body || typeof body !== "object") return null;
  const b = /** @type {Record<string, unknown>} */ (body);
  if (!LIMIT_REASONS.includes(/** @type {any} */ (b.reason))) return null;
  if (!isCount(b.limit)) return null;
  const limit = /** @type {number} */ (b.limit);

  switch (b.reason) {
    case "path-too-long":
      if (!isStringList(b.paths)) return null;
      return {
        reason: "path-too-long",
        limit,
        paths: [.../** @type {string[]} */ (b.paths)],
      };
    case "file-too-large": {
      if (!isStringList(b.paths)) return null;
      const paths = /** @type {string[]} */ (b.paths);
      const given = /** @type {Record<string, unknown>} */ (b.sizes);
      if (!given || typeof given !== "object") return null;
      if (!paths.every((path) => isCount(given[path]))) return null;
      return {
        reason: "file-too-large",
        limit,
        paths: [...paths],
        sizes: Object.fromEntries(
          paths.map((path) => [path, /** @type {number} */ (given[path])])
        ),
      };
    }
    case "too-many-files":
      if (!isCount(b.count)) return null;
      return {
        reason: "too-many-files",
        limit,
        count: /** @type {number} */ (b.count),
      };
    default:
      if (!isCount(b.size)) return null;
      return {
        reason: "project-too-large",
        limit,
        size: /** @type {number} */ (b.size),
      };
  }
};

const encoder = new TextEncoder();

/**
 * A string's size in UTF-8 bytes. `octet_length` measures the same thing on
 * a `text` column in a UTF-8 database, which is what the server sums.
 *
 * @param {string} content
 */
export const byteLength = (content) => encoder.encode(content).length;

/** @param {string} path */
const pathLength = (path) => [...path].length;

/**
 * Check a project's files against every limit.
 *
 * `files` maps workspace-relative paths to contents; paths sync does not carry
 * (`.workspace/metadata.json` and the like) are left out of every measure.
 * The limits are checked in the order path, file size, file count, project
 * size, and the first one the project is over is returned: one thing to fix
 * at a time, and the cheapest to name first.
 *
 * @param {Record<string, string>} files
 * @returns {LimitExceeded | null}
 */
export const checkProjectLimits = (files) => {
  const entries = Object.entries(files).filter(([path]) => isSyncedPath(path));

  const longPaths = entries
    .map(([path]) => path)
    .filter((path) => pathLength(path) > PROJECT_LIMITS.pathChars);
  if (longPaths.length) return limitExceeded.pathTooLong(longPaths);

  /** @type {Record<string, number>} */
  const sizes = {};
  let size = 0;
  for (const [path, content] of entries) {
    sizes[path] = byteLength(content);
    size += sizes[path];
  }

  const largeFiles = Object.keys(sizes).filter(
    (path) => sizes[path] > PROJECT_LIMITS.fileBytes
  );
  if (largeFiles.length) {
    return limitExceeded.fileTooLarge(
      Object.fromEntries(largeFiles.map((path) => [path, sizes[path]]))
    );
  }

  const count = entries.filter(
    ([path]) => !SYNCED_WORKSPACE_FILES.includes(path)
  ).length;
  if (count > PROJECT_LIMITS.files) return limitExceeded.tooManyFiles(count);

  if (size > PROJECT_LIMITS.projectBytes) {
    return limitExceeded.projectTooLarge(size);
  }

  return null;
};

/**
 * The counted files and total bytes of the files sync carries, as
 * `checkProjectLimits` measures them.
 *
 * @param {Record<string, string>} files
 */
const measure = (files) => {
  let count = 0;
  let size = 0;
  for (const [path, content] of Object.entries(files)) {
    if (!isSyncedPath(path)) continue;
    if (!SYNCED_WORKSPACE_FILES.includes(path)) count++;
    size += byteLength(content);
  }
  return { count, size };
};

/**
 * The limit writing one file would break, or `null`: the file's own path or
 * size, the file count when the path is new, the project size when the write
 * grows it.
 *
 * Only what the write itself makes worse. A project restored over a limit is
 * not refused every write: an edit that adds no file and no bytes goes
 * through, so the user and the assistant can still bring it back under, and
 * a refusal never names a limit some other file broke.
 *
 * @param {Record<string, string>} files the project before the write
 * @param {string} path workspace-relative
 * @param {string} content
 * @returns {LimitExceeded | null}
 */
export const checkFileWrite = (files, path, content) => {
  const own = checkProjectLimits({ [path]: content });
  if (own || !isSyncedPath(path)) return own;

  const before = measure(files);
  const after = measure(Object.assign({}, files, { [path]: content }));
  if (after.count > before.count && after.count > PROJECT_LIMITS.files) {
    return limitExceeded.tooManyFiles(after.count);
  }
  if (after.size > before.size && after.size > PROJECT_LIMITS.projectBytes) {
    return limitExceeded.projectTooLarge(after.size);
  }
  return null;
};
