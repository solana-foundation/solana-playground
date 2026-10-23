import assert from "node:assert/strict";
import test from "node:test";

import { formatReport } from "./bundle-info-diff.mjs";

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
  ["numbered chunks", "2", "1.48 MB"],
];

const BASE = snapshot({ chunks: BASE_CHUNKS });

const report = (fresh, stale = false) =>
  formatReport({
    base: BASE,
    fresh,
    baseLabel: "master",
    head: "abc1234",
    stale,
  });

test("a row within the tolerance is counted as noise, not listed, under a heading naming the head", () => {
  const text = report(
    snapshot({
      chunks: [
        ["main", "1", "480 kB"],
        ["numbered chunks", "2", "1.49 MB"],
      ],
    })
  );
  assert.ok(
    text.startsWith("### Bundle change vs `master`\n\nHead: abc1234\n"),
    text
  );
  assert.match(text, /No row moved past the 11 KiB tolerance\./);
  assert.match(text, /_2 rows moved within the 11 KiB tolerance \(noise\)\._/);
  assert.doesNotMatch(text, /470 kB → 480 kB/);
});

// [case, fresh snapshot, summary line, the change tables the report holds under it]
const LISTED = [
  [
    "a grown chunk and the `*.js` total with it",
    snapshot({
      jsGzip: "490 kB",
      chunks: [
        ["main", "1", "490 kB"],
        ["numbered chunks", "2", "1.48 MB"],
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
        ["numbered chunks", "2", "1.48 MB"],
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
];

for (const [name, fresh, summary, table] of LISTED) {
  test(`the report lists ${name} under its table's header`, () => {
    const text = report(fresh);
    const expected = [summary, ""].concat(table).join("\n");
    assert.ok(text.includes(expected), `missing\n${expected}\nin:\n${text}`);
  });
}

// [case, stale]: the report asks for a refresh exactly when the snapshot is stale
const STALE = [
  ["a stale snapshot gets a refresh line", true],
  ["a current snapshot gets no refresh line", false],
];

for (const [name, stale] of STALE) {
  test(name, () => {
    const text = report(BASE, stale);
    assert.equal(text.includes("is out of date for this branch"), stale);
  });
}

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
  assert.doesNotMatch(text, /No row moved/);
});

test("the fresh tables are collapsed without the snapshot's title", () => {
  const text = report(BASE);
  const details = text.slice(text.indexOf("<details>"));
  assert.ok(details.includes("| `main` | 1 | 470 kB |"));
  assert.ok(!details.includes("# Bundle sizes"));
});

test("a fresh file without a table throws", () => {
  assert.throws(() => report("# Bundle sizes\n"), /No table rows found/);
});
