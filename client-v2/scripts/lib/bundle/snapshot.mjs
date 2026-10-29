// Measures the production bundle and renders the bench/BUNDLE.md snapshot; ported from the Solana Explorer's scripts/update-build-info.js
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.join(import.meta.dirname, "..", "..", "..");
export const BUILD = path.join(ROOT, "build");
export const SNAPSHOT = path.join(ROOT, "bench", "BUNDLE.md");
/** {@link SNAPSHOT} from the repository root, as `git show` and the report name it */
export const SNAPSHOT_PATH = path.relative(path.dirname(ROOT), SNAPSHOT);

// Just over the coarsest display step (10 kB, and 0.01 MB is 10.24 KiB), so a rebuild's rounding never moves a cell
export const DISPLAY_STEP_TOLERANCE_BYTES = 11 * 1024;
export const TOLERANCE_LABEL = `${DISPLAY_STEP_TOLERANCE_BYTES / 1024} KiB`;

// CI measures the merge commit with no GA id; the empty value wins over client-v2/.env, which dotenv does not override
export const REFRESH_STEPS =
  "rebase onto the base branch, run `REACT_APP_GA_MEASUREMENT_ID= yarn build-fast`, then `yarn bundle:info`, and commit the refreshed file";

const UNIT_FACTORS = { B: 1, kB: 1024, MB: 1024 * 1024 };

/** Nearest 10 B under 1 kB, up to the next 10 kB under 1000 kB, 0.01 MB above */
export const formatBytes = (bytes) => {
  if (bytes < 1024) return `${Math.round(bytes / 10) * 10} B`;
  const kb = Math.ceil(bytes / 1024 / 10) * 10;
  if (kb < 1000) return `${kb} kB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

/** A displayed size back to bytes; `undefined` for a cell that is not a size, such as a file count */
export const parseCellBytes = (cell) => {
  const [value, unit, ...rest] = cell.split(" ");
  const numeric = Number(value);
  if (
    value === "" ||
    Number.isNaN(numeric) ||
    !Object.hasOwn(UNIT_FACTORS, unit ?? "") ||
    rest.length > 0
  ) {
    return undefined;
  }
  return numeric * UNIT_FACTORS[unit];
};

/** Keeps the committed cell while the fresh cell is within {@link DISPLAY_STEP_TOLERANCE_BYTES} of it */
export const stabiliseCell = (bytes, previousCell) => {
  const cell = formatBytes(bytes);
  const previousBytes =
    previousCell === undefined ? undefined : parseCellBytes(previousCell);
  if (previousBytes === undefined) return cell;
  // Only generator output anchors, so a hand edit in a form `formatBytes` would not produce fails the freshness test
  if (formatBytes(previousBytes) !== previousCell) return cell;
  return Math.abs(parseCellBytes(cell) - previousBytes) <=
    DISPLAY_STEP_TOLERANCE_BYTES
    ? previousCell
    : cell;
};

/** The file name up to its first dot: webpack's chunk name (`main`) or numeric chunk id (`9859`) */
const chunkId = (fileName) => fileName.split(".")[0];

const SEPARATOR = /^\|(\s*:?-+:?\s*\|)+$/;

/**
 * The data rows of every table in `markdown`, in document order: rows below a table's separator whose first cell is
 * backticked. `header` is the header line of the row's table.
 */
export const parseRows = (markdown) => {
  const rows = [];
  let header;
  let previousLine;
  for (const line of markdown.split("\n")) {
    if (!line.trim().startsWith("|")) header = undefined;
    if (SEPARATOR.test(line.trim())) header = previousLine;
    previousLine = line;
    if (header === undefined) continue;
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 4 || parts[0] !== "" || parts.at(-1) !== "") continue;
    const key = parts[1];
    if (key.length < 3 || !key.startsWith("`") || !key.endsWith("`")) continue;
    rows.push({ header, key: key.slice(1, -1), cells: parts.slice(2, -1) });
  }
  return rows;
};

const sizes = async (dir, extension) => {
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    if (e.code === "ENOENT") {
      throw new Error(`no ${dir}: run yarn build-fast first`);
    }
    throw e;
  }
  const files = [];
  for (const name of names.filter((n) => n.endsWith(extension)).sort()) {
    const bytes = await fs.readFile(path.join(dir, name));
    files.push({ name, raw: bytes.length, gzip: zlib.gzipSync(bytes).length });
  }
  return files;
};

const total = (files) => ({
  count: files.length,
  raw: files.reduce((sum, f) => sum + f.raw, 0),
  gzip: files.reduce((sum, f) => sum + f.gzip, 0),
});

export const OTHER_CHUNKS = "other chunks";
export const WORKER_PREFIX = "worker:";

/**
 * One row per named chunk and per worker ({@link WORKER_PREFIX} and its name), sorted, then one {@link OTHER_CHUNKS}
 * row summing the rest; webpack names those by a numeric id, which says nothing about their content
 */
export const chunkRows = (chunks, workers) => {
  const isOther = (f) => /^\d+$/.test(chunkId(f.name));
  const named = chunks
    .filter((f) => !isOther(f))
    .map((f) => ({ id: chunkId(f.name), count: 1, gzip: f.gzip }))
    .concat(
      workers.map((f) => ({
        id: `${WORKER_PREFIX}${chunkId(f.name)}`,
        count: 1,
        gzip: f.gzip,
      }))
    )
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
  const { count, gzip } = total(chunks.filter(isOther));
  return named.concat({ id: OTHER_CHUNKS, count, gzip });
};

/**
 * Raw and gzipped bytes of `static/js/*.js` with the Monaco workers `*.worker.js` at the root of `buildDir`, and of
 * `static/css/*.css`; gzipped bytes per {@link chunkRows} row
 */
export const measure = async (buildDir = BUILD) => {
  const chunks = await sizes(path.join(buildDir, "static", "js"), ".js");
  const workers = await sizes(buildDir, ".worker.js");
  const css = await sizes(path.join(buildDir, "static", "css"), ".css");
  if (chunks.length === 0) throw new Error(`no .js files under ${buildDir}`);
  return {
    js: total(chunks.concat(workers)),
    css: total(css),
    chunks: chunkRows(chunks, workers),
  };
};

const PREAMBLE = [
  "# Bundle sizes",
  "",
  `Generated by \`yarn bundle:info\` from the production build. Do not edit it by hand: \`yarn test-build\` fails unless a fresh measurement reproduces it byte for byte. To refresh it, ${REFRESH_STEPS}.`,
  "",
  `\`*.js\` counts \`static/js/*.js\` and the Monaco workers at the root of \`build/\`. The \`*.module.wasm\` files are not measured. \`main\`, any other named chunk, and each worker (\`${WORKER_PREFIX}<name>\`) get a row of their own; \`${OTHER_CHUNKS}\` sums the rest.`,
  "",
  `Sizes are rounded: to 10 B under 1 kB, up to the next 10 kB under 1000 kB, and to 0.01 MB above. A kB is 1024 B and an MB is 1024 kB. A fresh cell within ${TOLERANCE_LABEL} of the committed cell (\`DISPLAY_STEP_TOLERANCE_BYTES\`) keeps the committed value, so a rebuild of the same commit leaves this file unchanged.`,
  "",
];

/**
 * The snapshot's tables without its preamble; each size cell is stabilised against the same row and column of
 * `previous`, a snapshot or `null`
 */
export const renderTables = (measurement, previous = null) => {
  const anchors = new Map(
    parseRows(previous ?? "").map((r) => [r.key, r.cells])
  );
  const cell = (key, column, bytes) =>
    stabiliseCell(bytes, anchors.get(key)?.[column]);
  const totalRow = (key, { count, raw, gzip }) =>
    `| \`${key}\` | ${count} | ${cell(key, 1, raw)} | ${cell(key, 2, gzip)} |`;

  return [
    "| Files | Count | Raw | Gzipped |",
    "| --- | --- | --- | --- |",
    totalRow("*.js", measurement.js),
    totalRow("*.css", measurement.css),
    "",
    "| Chunk | Count | Gzipped |",
    "| --- | --- | --- |",
    ...measurement.chunks.map(
      ({ id, count, gzip }) => `| \`${id}\` | ${count} | ${cell(id, 1, gzip)} |`
    ),
    "",
  ].join("\n");
};

/** The snapshot's markdown: the preamble and {@link renderTables} */
export const renderSnapshot = (measurement, previous = null) =>
  [...PREAMBLE, renderTables(measurement, previous)].join("\n");

/** A snapshot file's markdown, or `null` when the file does not exist */
export const readSnapshot = (file = SNAPSHOT) =>
  fs.readFile(file, "utf8").catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });

/** Whether `committed` (`null` when absent) differs from the measurement rendered on it */
export const isStale = (measurement, committed) =>
  renderSnapshot(measurement, committed) !== committed;

/** The snapshot of `buildDir`, anchored on the committed bench/BUNDLE.md */
export const freshSnapshot = async (buildDir = BUILD) =>
  renderSnapshot(await measure(buildDir), await readSnapshot());
