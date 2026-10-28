import assert from "node:assert/strict";
import test from "node:test";

import { bundleReport, formatReport } from "./diff.mjs";
import { renderSnapshot } from "./snapshot.mjs";

const FILES_HEADER = [
  "| Files | Count | Raw | Gzipped |",
  "| --- | --- | --- | --- |",
];
const CHUNK_HEADER = ["| Chunk | Count | Gzipped |", "| --- | --- | --- |"];

const snapshot = ({ jsCount = "2", jsGzip = "470 kB", chunks }) =>
  [
    "# Bundle sizes",
    "",
    FILES_HEADER[0],
    FILES_HEADER[1],
    `| \`*.js\` | ${jsCount} | 1.48 MB | ${jsGzip} |`,
    "| `*.css` | 1 | 30 kB | 10 kB |",
    "",
    CHUNK_HEADER[0],
    CHUNK_HEADER[1],
  ]
    .concat(
      chunks.map(([id, count, cell]) => `| \`${id}\` | ${count} | ${cell} |`),
      [""]
    )
    .join("\n");

const BASE_CHUNKS = [
  ["main", "1", "470 kB"],
  ["other chunks", "2", "1.48 MB"],
];

const BASE = snapshot({ chunks: BASE_CHUNKS });

const report = (fresh) =>
  formatReport({
    base: BASE,
    fresh,
    baseLabel: "master",
    head: "abc1234",
    stale: false,
  });

test("an unchanged table says no row moved, under a heading naming the head", () => {
  const text = report(BASE);
  assert.ok(
    text.startsWith(
      "### Bundle change vs `master`\n\nHead: abc1234\n\nNo row moved past the 11 KiB tolerance.\n"
    ),
    text
  );
});

// [case, fresh snapshot, summary line, the change tables the report holds under it]
const LISTED = [
  [
    "a grown chunk and the `*.js` total with it",
    snapshot({
      jsGzip: "490 kB",
      chunks: [
        ["main", "1", "490 kB"],
        ["other chunks", "2", "1.48 MB"],
      ],
    }),
    "**2 changed, 0 added, 0 removed**",
    FILES_HEADER.concat(
      ["| `*.js` | 2 | 1.48 MB | 470 kB → 490 kB |", ""],
      CHUNK_HEADER,
      ["| `main` | 1 | 470 kB → 490 kB |"]
    ),
  ],
  [
    "a removed chunk and an added worker",
    snapshot({
      chunks: [
        ["other chunks", "2", "1.48 MB"],
        ["worker:json", "1", "10 kB"],
      ],
    }),
    "**0 changed, 1 added, 1 removed**",
    CHUNK_HEADER.concat([
      "| `worker:json` _(added)_ | 1 | 10 kB |",
      "| `main` _(removed)_ | 1 | 470 kB |",
    ]),
  ],
  [
    "a changed file count",
    snapshot({ jsCount: "3", chunks: BASE_CHUNKS }),
    "**1 changed, 0 added, 0 removed**",
    FILES_HEADER.concat(["| `*.js` | 2 → 3 | 1.48 MB | 470 kB |"]),
  ],
  [
    "a row with an extra cell",
    snapshot({
      chunks: [
        ["main", "1", "470 kB | 10 kB"],
        ["other chunks", "2", "1.48 MB"],
      ],
    }),
    "**1 changed, 0 added, 0 removed**",
    CHUNK_HEADER.concat(["| `main` | 1 | 470 kB | 10 kB |"]),
  ],
];

for (const [name, fresh, summary, table] of LISTED) {
  test(`the report lists ${name} under its table's header`, () => {
    const text = report(fresh);
    const expected = [summary, ""].concat(table).join("\n");
    assert.ok(text.includes(expected), `missing\n${expected}\nin:\n${text}`);
  });
}

const KB = 1024;

const measured = (main) => ({
  js: { count: 2, raw: 1500 * KB, gzip: 470 * KB },
  css: { count: 1, raw: 30 * KB, gzip: 10 * KB },
  chunks: [
    { id: "main", count: 1, gzip: main },
    { id: "other chunks", count: 1, gzip: 470 * KB },
  ],
});

// [case, committed snapshot, stale]: base 470 kB, build 485 KiB; the row is listed against the base either way
const BUNDLE_REPORT = [
  [
    "a committed cell within the tolerance of the build",
    renderSnapshot(measured(480 * KB)),
    false,
  ],
  [
    "a committed cell past the tolerance of the build",
    renderSnapshot(measured(440 * KB)),
    true,
  ],
  ["no committed snapshot", null, true],
];

for (const [name, committed, stale] of BUNDLE_REPORT) {
  test(`bundleReport: ${name}`, () => {
    const text = bundleReport({
      measurement: measured(485 * KB),
      committed,
      base: renderSnapshot(measured(470 * KB)),
      baseLabel: "master",
      head: "abc1234",
    });
    assert.ok(text.includes("| `main` | 1 | 470 kB → 490 kB |"), text);
    assert.equal(text.includes("is out of date for this branch"), stale);
  });
}

// Base `main` holds 470 kB over 479.5 KiB; 478 KiB renders 480 kB alone, and anchored on the base it keeps 470 kB
test("bundleReport renders a cell within the tolerance of the base as the base cell", () => {
  const base = renderSnapshot(
    measured(479.5 * KB),
    renderSnapshot(measured(470 * KB))
  );
  const text = bundleReport({
    measurement: measured(478 * KB),
    committed: base,
    base,
    baseLabel: "master",
    head: "abc1234",
  });
  assert.match(text, /No row moved past the 11 KiB tolerance\.\n\n<details>/);
  assert.ok(text.includes("| `main` | 1 | 470 kB |"), text);
});

test("a base branch without a snapshot is named and nothing is diffed", () => {
  const text = formatReport({
    base: null,
    fresh: BASE,
    baseLabel: "master",
    head: "abc1234",
    stale: false,
  });
  assert.match(
    text,
    /`master` has no `client-v2\/bench\/BUNDLE\.md`, so there is nothing to compare against\./
  );
});

test("the fresh tables are collapsed", () => {
  const text = report(BASE);
  const details = text.slice(text.indexOf("<details>"));
  assert.ok(details.includes("| `main` | 1 | 470 kB |"));
});

test("a fresh file without a table throws", () => {
  assert.throws(() => report("# Bundle sizes\n"), /No table rows found/);
});
