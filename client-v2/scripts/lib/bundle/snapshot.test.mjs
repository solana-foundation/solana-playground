import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

import {
  chunkRows,
  formatBytes,
  measure,
  parseRows,
  readSnapshot,
  renderSnapshot,
  stabiliseCell,
} from "./snapshot.mjs";

const KB = 1024;
const MB = 1024 * 1024;

// [bytes, cell]: the last value of one unit and the first of the next
const ROUNDING = [
  [1023, "1020 B"],
  [1024, "10 kB"],
  [990 * KB, "990 kB"],
  [990 * KB + 1, "0.97 MB"],
];

for (const [bytes, cell] of ROUNDING) {
  test(`formatBytes(${bytes}) is ${cell}`, () => {
    assert.equal(formatBytes(bytes), cell);
  });
}

// [case, fresh bytes, committed cell, expected cell]; renderSnapshot's round trip covers the cells kept within the tolerance
const HYSTERESIS = [
  ["a new row takes the fresh cell", 470.2 * KB, undefined, "480 kB"],
  [
    "a shrink past the tolerance takes the fresh cell",
    440 * KB,
    "470 kB",
    "440 kB",
  ],
  [
    "a hand-edited committed cell does not anchor",
    470.2 * KB,
    "475 kB",
    "480 kB",
  ],
  // Within the tolerance in bytes, past it in displayed cells, which stabiliseCell compares
  [
    "a cell two steps up takes the fresh cell",
    480 * KB + 1,
    "470 kB",
    "490 kB",
  ],
];

for (const [name, bytes, committed, expected] of HYSTERESIS) {
  test(`stabiliseCell: ${name}`, () => {
    assert.equal(stabiliseCell(bytes, committed), expected);
  });
}

// `web3` comes before `main` and carries a digit: the rows are sorted, and only an all-digit id is summed
test("chunkRows gives a named chunk and a worker a row each, sorted, and sums the other chunks", () => {
  const file = (name, gzip) => ({ name, raw: gzip, gzip });
  assert.deepEqual(
    chunkRows(
      [
        file("web3.5a6b7c8d.chunk.js", 5),
        file("9859.0f4e9123.chunk.js", 10),
        file("main.c7d1e66b.js", 20),
        file("12.ab34cd56.chunk.js", 30),
      ],
      [file("ts.worker.js", 40)]
    ),
    [
      { id: "main", count: 1, gzip: 20 },
      { id: "web3", count: 1, gzip: 5 },
      { id: "worker:ts", count: 1, gzip: 40 },
      { id: "other chunks", count: 2, gzip: 40 },
    ]
  );
});

const measurement = ({ jsRaw, jsGzip, cssGzip, other, main }) => ({
  js: { count: 2, raw: jsRaw, gzip: jsGzip },
  css: { count: 1, raw: 30 * KB, gzip: cssGzip },
  chunks: [
    { id: "main", count: 1, gzip: main },
    { id: "other chunks", count: 1, gzip: other },
  ],
});

const COMMITTED = renderSnapshot(
  measurement({
    jsRaw: 1.48 * MB,
    jsGzip: 470 * KB,
    cssGzip: 10 * KB,
    other: 470 * KB,
    main: 1.48 * MB,
  })
);

test("renderSnapshot reproduces the committed file when every cell moved within the tolerance", () => {
  const fresh = measurement({
    jsRaw: 1.487 * MB,
    jsGzip: 470.2 * KB,
    cssGzip: 10.2 * KB,
    other: 470.2 * KB,
    main: 1.487 * MB,
  });
  assert.equal(renderSnapshot(fresh, COMMITTED), COMMITTED);
});

/** Raw and gzipped bytes of `content`, gzipped as `measure` does */
const sizeOf = (content) => {
  const bytes = Buffer.from(content);
  return { raw: bytes.length, gzip: zlib.gzipSync(bytes).length };
};

/** Serves `tree`, each directory mapped to its files' contents, through the `fs` that `measure` reads */
const mockBuild = (t, tree) => {
  t.mock.method(fs, "readdir", async (dir) => {
    if (!(dir in tree)) {
      throw Object.assign(new Error(`ENOENT: ${dir}`), { code: "ENOENT" });
    }
    return Object.keys(tree[dir]);
  });
  t.mock.method(fs, "readFile", async (file) =>
    Buffer.from(tree[path.dirname(file)][path.basename(file)])
  );
};

const MAIN = 'console.log("main chunk");';
const OTHER = 'console.log("a numbered chunk, summed into other chunks");';
const WORKER = 'self.onmessage = () => self.postMessage("a Monaco worker");';
const CSS = ".flex{display:flex}";

// `service-worker.js` sits at the root without the `.worker.js` suffix, so it is not a Monaco worker
test("measure counts the chunks and the root workers in *.js, and nothing else at the root", async (t) => {
  mockBuild(t, {
    "/build": {
      "ts.worker.js": WORKER,
      "service-worker.js": "// not a Monaco worker",
    },
    "/build/static/js": {
      "main.c7d1e66b.js": MAIN,
      "9859.0f4e9123.chunk.js": OTHER,
    },
    "/build/static/css": { "main.5e8a1b2c.css": CSS },
  });
  const [main, other, worker, css] = [MAIN, OTHER, WORKER, CSS].map(sizeOf);
  assert.deepEqual(await measure("/build"), {
    js: {
      count: 3,
      raw: main.raw + other.raw + worker.raw,
      gzip: main.gzip + other.gzip + worker.gzip,
    },
    css: { count: 1, raw: css.raw, gzip: css.gzip },
    chunks: [
      { id: "main", count: 1, gzip: main.gzip },
      { id: "worker:ts", count: 1, gzip: worker.gzip },
      { id: "other chunks", count: 1, gzip: other.gzip },
    ],
  });
});

test("measure throws on a build whose static/js holds no .js file", async (t) => {
  mockBuild(t, {
    "/build": {},
    "/build/static/js": { "main.c7d1e66b.js.LICENSE.txt": "a licence file" },
    "/build/static/css": { "main.5e8a1b2c.css": CSS },
  });
  await assert.rejects(measure("/build"), {
    message: /^no \.js files under /,
  });
});

test("readSnapshot of a missing file is null", async () => {
  assert.equal(
    await readSnapshot(
      path.join(import.meta.dirname, "no-such-dir", "BUNDLE.md")
    ),
    null
  );
});

test("parseRows skips a backticked row outside a table", () => {
  const rows = parseRows(
    "| `stray` | 1 | 2 |\n\n| Chunk | Count | Gzipped |\n| --- | --- | --- |\n| `main` | 1 | 10 kB |\n"
  );
  assert.deepEqual(
    rows.map((row) => row.key),
    ["main"]
  );
});
