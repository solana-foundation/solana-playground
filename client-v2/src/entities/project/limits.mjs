// The size and count limits a project is held to, read by the explorer, the
// sync client and `PUT /api/projects`, and the account cap, read by the
// server only. `.mjs` so Node runs it as written, as
// `features/auth/config.mjs` is; `allowJs` lets the browser side import the
// same file rather than restate a figure that must agree on both sides.
//
// A Playground project is an exercise: the largest bundled tutorial holds
// 12 KB in 3 files (12,471 bytes), so these sit far above that and far below
// the 4.5 MB a Vercel Function accepts as a request body.

// TODO(HOO-2604): the JSDoc types below are declared, not checked: the
// tsconfig has no `checkJs`.

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
 * How many projects one account syncs, by kind (HOO-2538). The limits above
 * bound one project; without a count one account could store any number.
 *
 * Tutorials count apart: the client ships 16, so counting them with projects
 * would leave an account that had started ten tutorials unable to sync a
 * project of its own. They are capped all the same, because a tutorial's id
 * is `tut:<name>` with the name chosen by the client. 32 is twice the
 * catalogue.
 *
 * Only the server applies these: it is the one place that knows what the
 * account holds.
 */
export const ACCOUNT_LIMITS = Object.freeze({
  /** Live projects of kind `project` that hold at least one synced file */
  projects: 10,
  /** The same, for kind `tutorial` */
  tutorials: 32,
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
 * At least one path: every limit that names paths names the ones over it.
 *
 * @typedef {[string, ...string[]]} Paths
 */

/**
 * The first limit a project is over, with what is over it: what the client's
 * check, the explorer and the server's measure report. `paths` is sorted and
 * `sizes` keyed in that order, so two reports of one limit compare equal
 * whichever side measured it.
 *
 * @typedef {{reason: "path-too-long", limit: number, paths: Paths}
 *   | {reason: "file-too-large", limit: number, paths: Paths,
 *      sizes: Record<string, number>}
 *   | {reason: "too-many-files", limit: number, count: number}
 *   | {reason: "project-too-large", limit: number, size: number}
 * } ProjectLimitExceeded
 */

/**
 * The account cap a write would break by making a project count (a create,
 * or a swap onto a row with no files): `count` is the projects of `kind` the
 * account would hold with this one, so `limit + 1` unless the account was
 * already over. Only the server finds it.
 *
 * @typedef {{reason: "too-many-projects", kind: "project" | "tutorial",
 *   limit: number, count: number}} AccountLimitExceeded
 */

/**
 * Any limit a write is refused for: the shape of a limit 413's body.
 *
 * @typedef {ProjectLimitExceeded | AccountLimitExceeded} LimitExceeded
 */

/** @typedef {LimitExceeded["reason"]} LimitReason */

/** @type {readonly LimitReason[]} */
export const LIMIT_REASONS = [
  "path-too-long",
  "file-too-large",
  "too-many-files",
  "project-too-large",
  "too-many-projects",
];

/**
 * The five `LimitExceeded` shapes, built here only, so the client's check and
 * the server's measure send the same fields under the same names.
 * `tooManyProjects` is the server's alone: no client can count the account.
 */
export const limitExceeded = Object.freeze({
  /** @param {Paths} paths */
  pathTooLong: (paths) => ({
    reason: /** @type {const} */ ("path-too-long"),
    limit: PROJECT_LIMITS.pathChars,
    paths: sortedPaths(paths),
  }),
  /** @param {Record<string, number>} sizes the size of each file over, at least one */
  fileTooLarge: (sizes) => {
    const paths = sortedPaths(/** @type {Paths} */ (Object.keys(sizes)));
    return {
      reason: /** @type {const} */ ("file-too-large"),
      limit: PROJECT_LIMITS.fileBytes,
      paths,
      sizes: sizesIn(paths)(sizes),
    };
  },
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
  /**
   * @param {"project" | "tutorial"} kind
   * @param {number} count the projects of `kind` with the one refused
   */
  tooManyProjects: (kind, count) => ({
    reason: /** @type {const} */ ("too-many-projects"),
    kind,
    limit:
      kind === "tutorial" ? ACCOUNT_LIMITS.tutorials : ACCOUNT_LIMITS.projects,
    count,
  }),
});

/**
 * A copy of `paths` in sorted order
 *
 * @param {Paths} paths
 * @returns {Paths}
 */
const sortedPaths = (paths) => /** @type {Paths} */ ([...paths].sort());

/**
 * `sizes` keyed in the order of `paths`, which it must hold
 *
 * @param {Paths} paths
 */
const sizesIn = (paths) => (/** @type {Record<string, number>} */ sizes) =>
  Object.fromEntries(paths.map((path) => [path, sizes[path]]));

/**
 * @param {unknown} value
 * @returns {value is Paths}
 */
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
  // eslint-disable-next-line unicorn/no-null -- the contract: `null` is "none", read by client and server
  if (!body || typeof body !== "object") return null;
  const b = /** @type {Record<string, unknown>} */ (body);
  // eslint-disable-next-line unicorn/no-null -- the contract: `null` is "none", read by client and server
  if (!LIMIT_REASONS.includes(/** @type {any} */ (b.reason))) return null;
  // eslint-disable-next-line unicorn/no-null -- the contract: `null` is "none", read by client and server
  if (!isCount(b.limit)) return null;
  const limit = /** @type {number} */ (b.limit);

  switch (b.reason) {
    case "path-too-long":
      // eslint-disable-next-line unicorn/no-null -- the contract: `null` is "none", read by client and server
      if (!isStringList(b.paths)) return null;
      return {
        reason: "path-too-long",
        limit,
        paths: sortedPaths(b.paths),
      };
    case "file-too-large": {
      // eslint-disable-next-line unicorn/no-null -- the contract: `null` is "none", read by client and server
      if (!isStringList(b.paths)) return null;
      const paths = sortedPaths(b.paths);
      const given = /** @type {Record<string, number>} */ (b.sizes);
      // eslint-disable-next-line unicorn/no-null -- the contract: `null` is "none", read by client and server
      if (!given || typeof given !== "object") return null;
      // eslint-disable-next-line unicorn/no-null -- the contract: `null` is "none", read by client and server
      if (!paths.every((path) => isCount(given[path]))) return null;
      return {
        reason: "file-too-large",
        limit,
        paths,
        sizes: sizesIn(paths)(given),
      };
    }
    case "too-many-files":
      // eslint-disable-next-line unicorn/no-null -- the contract: `null` is "none", read by client and server
      if (!isCount(b.count)) return null;
      return {
        reason: "too-many-files",
        limit,
        count: /** @type {number} */ (b.count),
      };
    case "too-many-projects":
      // eslint-disable-next-line unicorn/no-null -- the contract: `null` is "none", read by client and server
      if (!isCount(b.count)) return null;
      // eslint-disable-next-line unicorn/no-null -- the contract: `null` is "none", read by client and server
      if (b.kind !== "project" && b.kind !== "tutorial") return null;
      return {
        reason: "too-many-projects",
        kind: b.kind,
        limit,
        count: /** @type {number} */ (b.count),
      };
    case "project-too-large":
      // eslint-disable-next-line unicorn/no-null -- the contract: `null` is "none", read by client and server
      if (!isCount(b.size)) return null;
      return {
        reason: "project-too-large",
        limit,
        size: /** @type {number} */ (b.size),
      };
    default:
      // A reason this client has no case for: not one it can name
      // eslint-disable-next-line unicorn/no-null -- the contract: `null` is "none", read by client and server
      return null;
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
 * @returns {ProjectLimitExceeded | null}
 */
export const checkProjectLimits = (files) => {
  const entries = Object.entries(files).filter(([path]) => isSyncedPath(path));

  const longPaths = entries
    .map(([path]) => path)
    .filter((path) => pathLength(path) > PROJECT_LIMITS.pathChars);
  if (isStringList(longPaths)) return limitExceeded.pathTooLong(longPaths);

  // No prototype: a body can name a file `__proto__`, which a plain object's
  // inherited setter would take instead of keeping it as an entry
  /** @type {Record<string, number>} */
  const sizes = Object.create(null);
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

  // eslint-disable-next-line unicorn/no-null -- the contract: `null` is "none", read by client and server
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
 * The limit writing one file would leave broken, or `null`: the file's own
 * path or size, then the project's file count and size as the write leaves
 * them.
 *
 * Judged on the result, not on the change, as the server judges a write: a
 * write that shrinks a file or a project still over its limit is refused, so
 * a project restored over a limit takes deletes, which are never checked, and
 * only those writes that bring it back under. Another file's path or size is
 * not the write's to answer for: the sync banner names that file on the next
 * upload.
 *
 * Curried as the explorer calls it: the project, then the file, then what
 * is written to it.
 *
 * @param {Record<string, string>} files the project before the write
 */
export const checkWriteTo =
  (files) =>
  /** @param {string} path workspace-relative */
  (path) =>
  /**
   * @param {string} content
   * @returns {ProjectLimitExceeded | null}
   */
  (content) => {
    const own = checkProjectLimits({ [path]: content });
    if (own || !isSyncedPath(path)) return own;

    const after = measure(
      Object.assign(Object.create(null), files, { [path]: content })
    );
    if (after.count > PROJECT_LIMITS.files) {
      return limitExceeded.tooManyFiles(after.count);
    }
    if (after.size > PROJECT_LIMITS.projectBytes) {
      return limitExceeded.projectTooLarge(after.size);
    }
    // eslint-disable-next-line unicorn/no-null -- the contract: `null` is "none", read by client and server
    return null;
  };
