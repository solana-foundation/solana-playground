import assert from "node:assert/strict";
import test from "node:test";

import {
  chunkId,
  formatBytes,
  parseRows,
  renderSnapshot,
  stabiliseCell,
} from "./bundle-info.mjs";

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

// [case, fresh bytes, committed cell, expected cell]
const HYSTERESIS = [
  ["a new row takes the fresh cell", 470.2 * KB, undefined, "480 kB"],
  ["one 10 kB step keeps the committed cell", 470.2 * KB, "470 kB", "470 kB"],
  [
    "one 0.01 MB step keeps the committed cell",
    1.487 * MB,
    "1.48 MB",
    "1.48 MB",
  ],
  ["more than one step takes the fresh cell", 495 * KB, "470 kB", "500 kB"],
  [
    "a hand-edited committed cell does not anchor",
    470.2 * KB,
    "475 kB",
    "480 kB",
  ],
];

for (const [name, bytes, committed, expected] of HYSTERESIS) {
  test(`stabiliseCell: ${name}`, () => {
    assert.equal(stabiliseCell(bytes, committed), expected);
  });
}

test("chunkId is the file name up to its first dot", () => {
  assert.deepEqual(
    ["main.c7d1e66b.js", "9859.0f4e9123.chunk.js"].map(chunkId),
    ["main", "9859"]
  );
});

const measurement = ({ jsRaw, jsGzip, cssGzip, chunk1, chunk2 }) => ({
  js: { count: 2, raw: jsRaw, gzip: jsGzip },
  css: { count: 1, raw: 30 * KB, gzip: cssGzip },
  chunks: [
    { id: "1", gzip: chunk1 },
    { id: "main", gzip: chunk2 },
  ],
});

const COMMITTED = renderSnapshot(
  measurement({
    jsRaw: 1.48 * MB,
    jsGzip: 470 * KB,
    cssGzip: 10 * KB,
    chunk1: 470 * KB,
    chunk2: 1.48 * MB,
  })
);

test("parseRows reads every data row with its table's header", () => {
  assert.deepEqual(parseRows(COMMITTED), [
    {
      header: "| Files | Count | Raw | Gzipped |",
      key: "*.js",
      cells: ["2", "1.48 MB", "470 kB"],
    },
    {
      header: "| Files | Count | Raw | Gzipped |",
      key: "*.css",
      cells: ["1", "30 kB", "10 kB"],
    },
    { header: "| Chunk | Gzipped |", key: "1", cells: ["470 kB"] },
    { header: "| Chunk | Gzipped |", key: "main", cells: ["1.48 MB"] },
  ]);
});

test("renderSnapshot reproduces the committed file when every cell moved within one step", () => {
  const fresh = measurement({
    jsRaw: 1.487 * MB,
    jsGzip: 470.2 * KB,
    cssGzip: 10.2 * KB,
    chunk1: 470.2 * KB,
    chunk2: 1.487 * MB,
  });
  assert.equal(renderSnapshot(fresh, COMMITTED), COMMITTED);
});

test("renderSnapshot changes only the row that moved past one step", () => {
  const fresh = measurement({
    jsRaw: 1.48 * MB,
    jsGzip: 470 * KB,
    cssGzip: 10 * KB,
    chunk1: 495 * KB,
    chunk2: 1.48 * MB,
  });
  assert.equal(
    renderSnapshot(fresh, COMMITTED),
    COMMITTED.replace("| `1` | 470 kB |", "| `1` | 500 kB |")
  );
});
