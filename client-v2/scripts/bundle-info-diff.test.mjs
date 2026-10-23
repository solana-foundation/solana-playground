import assert from "node:assert/strict";
import test from "node:test";

import { formatReport } from "./bundle-info-diff.mjs";

const snapshot = ({ jsCount = "2", chunks }) =>
  [
    "# Bundle sizes",
    "",
    "| Files | Count | Raw | Gzipped |",
    "| --- | --- | --- | --- |",
    `| \`*.js\` | ${jsCount} | 1.48 MB | 470 kB |`,
    "| `*.css` | 1 | 30 kB | 10 kB |",
    "",
    "| Chunk | Gzipped |",
    "| --- | --- |",
    ...chunks.map(([id, cell]) => `| \`${id}\` | ${cell} |`),
    "",
  ].join("\n");

const BASE = snapshot({
  chunks: [
    ["1", "470 kB"],
    ["main", "1.48 MB"],
  ],
});

const report = (fresh, options = {}) =>
  formatReport({
    base: BASE,
    fresh,
    baseLabel: "master",
    stale: options.stale ?? false,
  });

test("a row within one display step is counted as noise, not listed", () => {
  const text = report(
    snapshot({
      chunks: [
        ["1", "480 kB"],
        ["main", "1.49 MB"],
      ],
    })
  );
  assert.match(text, /No chunk size changed\./);
  assert.match(text, /_2 rows moved by one rounding step \(noise\)\._/);
  assert.doesNotMatch(text, /470 kB → 480 kB/);
});

// [case, fresh snapshot, line the report lists]
const LISTED = [
  [
    "a row past one display step",
    snapshot({
      chunks: [
        ["1", "500 kB"],
        ["main", "1.48 MB"],
      ],
    }),
    "| `1` | 470 kB → 500 kB |",
  ],
  [
    "an added row",
    snapshot({
      chunks: [
        ["1", "470 kB"],
        ["2", "10 kB"],
        ["main", "1.48 MB"],
      ],
    }),
    "| `2` _(added)_ | 10 kB |",
  ],
  [
    "a removed row",
    snapshot({ chunks: [["1", "470 kB"]] }),
    "| `main` _(removed)_ | 1.48 MB |",
  ],
  [
    "a changed file count",
    snapshot({
      jsCount: "3",
      chunks: [
        ["1", "470 kB"],
        ["main", "1.48 MB"],
      ],
    }),
    "| `*.js` | 2 → 3 | 1.48 MB | 470 kB |",
  ],
];

for (const [name, fresh, line] of LISTED) {
  test(`the report lists ${name} under its table's header`, () => {
    const text = report(fresh);
    assert.ok(text.includes(line), `missing ${line} in:\n${text}`);
    const header = line.startsWith("| `*.js`")
      ? "| Files | Count | Raw | Gzipped |"
      : "| Chunk | Gzipped |";
    assert.ok(
      text.indexOf(header) < text.indexOf(line),
      `${line} is not under ${header}`
    );
  });
}

// [stale, whether the report asks for a refresh]
const STALE = [
  [true, true],
  [false, false],
];

for (const [stale, asks] of STALE) {
  test(`a ${stale ? "stale" : "current"} snapshot ${
    asks ? "gets a" : "gets no"
  } refresh line`, () => {
    const text = report(BASE, { stale });
    assert.equal(text.includes("is out of date for this branch"), asks);
  });
}

test("a base branch without a snapshot is named and nothing is diffed", () => {
  const text = formatReport({
    base: null,
    fresh: BASE,
    baseLabel: "master",
    stale: false,
  });
  assert.match(
    text,
    /`master` has no `client-v2\/bench\/BUNDLE\.md`, so there is nothing to compare against\./
  );
  assert.doesNotMatch(text, /No chunk size changed/);
});

test("the fresh tables are collapsed without the snapshot's title", () => {
  const text = report(BASE);
  const details = text.slice(text.indexOf("<details>"));
  assert.ok(details.includes("| `main` | 1.48 MB |"));
  assert.ok(!details.includes("# Bundle sizes"));
});

test("a fresh file without a table throws", () => {
  assert.throws(() => report("# Bundle sizes\n"), /No table rows found/);
});
