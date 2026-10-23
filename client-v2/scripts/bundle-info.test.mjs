import assert from "node:assert/strict";
import test from "node:test";

import {
  chunkRows,
  formatBytes,
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
];

for (const [name, bytes, committed, expected] of HYSTERESIS) {
  test(`stabiliseCell: ${name}`, () => {
    assert.equal(stabiliseCell(bytes, committed), expected);
  });
}

test("chunkRows gives a named chunk and a worker a row each and sums the numbered chunks", () => {
  const file = (name, gzip) => ({ name, raw: gzip, gzip });
  assert.deepEqual(
    chunkRows(
      [
        file("9859.0f4e9123.chunk.js", 10),
        file("main.c7d1e66b.js", 20),
        file("12.ab34cd56.chunk.js", 30),
      ],
      [file("ts.worker.js", 40)]
    ),
    [
      { id: "main", count: 1, gzip: 20 },
      { id: "worker:ts", count: 1, gzip: 40 },
      { id: "numbered chunks", count: 2, gzip: 40 },
    ]
  );
});

const measurement = ({ jsRaw, jsGzip, cssGzip, numbered, main }) => ({
  js: { count: 2, raw: jsRaw, gzip: jsGzip },
  css: { count: 1, raw: 30 * KB, gzip: cssGzip },
  chunks: [
    { id: "main", count: 1, gzip: main },
    { id: "numbered chunks", count: 1, gzip: numbered },
  ],
});

const COMMITTED = renderSnapshot(
  measurement({
    jsRaw: 1.48 * MB,
    jsGzip: 470 * KB,
    cssGzip: 10 * KB,
    numbered: 470 * KB,
    main: 1.48 * MB,
  })
);

test("renderSnapshot reproduces the committed file when every cell moved within the tolerance", () => {
  const fresh = measurement({
    jsRaw: 1.487 * MB,
    jsGzip: 470.2 * KB,
    cssGzip: 10.2 * KB,
    numbered: 470.2 * KB,
    main: 1.487 * MB,
  });
  assert.equal(renderSnapshot(fresh, COMMITTED), COMMITTED);
});

test("renderSnapshot changes only the row that moved past the tolerance", () => {
  const fresh = measurement({
    jsRaw: 1.48 * MB,
    jsGzip: 470 * KB,
    cssGzip: 10 * KB,
    numbered: 490 * KB,
    main: 1.48 * MB,
  });
  assert.equal(
    renderSnapshot(fresh, COMMITTED),
    COMMITTED.replace(
      "| `numbered chunks` | 1 | 470 kB |",
      "| `numbered chunks` | 1 | 490 kB |"
    )
  );
});
