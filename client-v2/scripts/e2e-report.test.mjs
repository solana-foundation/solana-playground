import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { checkReports } from "./e2e-report.mjs";

const tempDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-report-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const specOn = (projectName) => (title, status) => ({
  title,
  tests: [{ status, projectName }],
});
const spec = specOn("chromium");

// The describe nesting of a real report: a file suite holding a describe
// suite holding the specs. A shard always ran some test of its project.
const reportOn =
  (project) =>
  ({ current, total, specs }) => ({
    config: { shard: { current, total } },
    suites: [
      {
        title: "a.e2e.spec.ts",
        suites: [
          { title: "a describe", specs },
          {
            title: "b describe",
            specs: [specOn(project)("passes", "expected")],
          },
        ],
      },
    ],
  });
const report = reportOn("chromium");

const shardFile = (dir, name) =>
  path.join(dir, `playwright-test-results-${name}`, "report.json");

const writeShard = (dir, name, content) => {
  const file = shardFile(dir, name);
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(
    file,
    typeof content === "string" ? content : JSON.stringify(content)
  );
  return file;
};

const writeKnownSkips = (dir, lines) => {
  const file = path.join(dir, "known-skips.txt");
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
};

const fourShards = (dir, specsOf = () => []) => {
  for (const n of [1, 2, 3, 4]) {
    writeShard(dir, n, report({ current: n, total: 4, specs: specsOf(n) }));
  }
};

const checkFor = (expectedProjects) => (dir, knownSkipsFile) =>
  checkReports({
    reportsDir: path.join(dir, "shards"),
    knownSkipsFile,
    expectedProjects,
  });
const check = checkFor(["chromium"]);
const checkBoth = checkFor(["chromium", "firefox"]);

const writeProjectShards = (shards, project, { current, total }) => {
  for (const n of current) {
    writeShard(
      shards,
      `${project}-${n}`,
      reportOn(project)({ current: n, total, specs: [] })
    );
  }
};

const setUp = (t) => {
  const dir = tempDir(t);
  const shards = path.join(dir, "shards");
  fs.mkdirSync(shards);
  return { dir, shards };
};

describe("scripts/e2e-report", () => {
  it("four complete reports pass with the stale and flaky warnings only", (t) => {
    const { dir, shards } = setUp(t);
    fourShards(shards, (n) => {
      if (n === 1) return [spec("ran after all", "expected")];
      if (n === 2) return [spec("still skips", "skipped")];
      if (n === 3) return [spec("passed on retry", "flaky")];
      return [spec("plain pass", "expected")];
    });
    const known = writeKnownSkips(dir, ["still skips", "ran after all"]);
    assert.deepEqual(check(dir, known), {
      ok: true,
      lines: [
        "chromium shards reported: 1 2 3 4 of 4",
        `::warning title=stale known skip::ran after all -- listed in ${known} but ran`,
        "::warning title=flaky e2e test::[chromium] passed on retry -- failed once on this runner, passed on retry; its trace is in the shard's artifact",
      ],
    });
  });

  it("no report at all is an error, not a pass", (t) => {
    const { dir, shards } = setUp(t);
    const known = writeKnownSkips(dir, []);
    assert.deepEqual(check(dir, known), {
      ok: false,
      lines: [
        `::error::no ${path.join(
          shards,
          "*",
          "report.json"
        )} -- no shard ran to a report`,
      ],
    });
  });

  it("a missing shard is an error naming the shards that reported", (t) => {
    const { dir, shards } = setUp(t);
    for (const n of [1, 2, 4]) {
      writeShard(shards, n, report({ current: n, total: 4, specs: [] }));
    }
    const known = writeKnownSkips(dir, []);
    assert.deepEqual(check(dir, known), {
      ok: false,
      lines: [
        "::error::chromium shards 1 2 4 of 4 reported -- every one of 1..4 must",
      ],
    });
  });

  it("a truncated report is an error naming the file", (t) => {
    const { dir, shards } = setUp(t);
    for (const n of [1, 2, 4]) {
      writeShard(shards, n, report({ current: n, total: 4, specs: [] }));
    }
    const truncated = writeShard(shards, 3, '{"config":{"shard":');
    const known = writeKnownSkips(dir, []);
    assert.deepEqual(check(dir, known), {
      ok: false,
      lines: [
        `::error::${truncated} is not JSON -- the upload is truncated or the run died mid-write`,
      ],
    });
  });

  it("a report without config.shard is an error naming the file", (t) => {
    const { dir, shards } = setUp(t);
    for (const n of [1, 2, 4]) {
      writeShard(shards, n, report({ current: n, total: 4, specs: [] }));
    }
    const unsharded = writeShard(shards, 3, {
      config: { shard: null },
      suites: [],
    });
    const known = writeKnownSkips(dir, []);
    assert.deepEqual(check(dir, known), {
      ok: false,
      lines: [
        `::error::${unsharded} has no config.shard -- the run was not sharded`,
      ],
    });
  });

  it("reports that disagree on their total are an error", (t) => {
    const { dir, shards } = setUp(t);
    writeShard(shards, 1, report({ current: 1, total: 2, specs: [] }));
    writeShard(shards, 2, report({ current: 2, total: 4, specs: [] }));
    const known = writeKnownSkips(dir, []);
    assert.deepEqual(check(dir, known), {
      ok: false,
      lines: ["::error::the chromium shards disagree on their total: 2 4"],
    });
  });

  it("a skip outside the known list is an error", (t) => {
    const { dir, shards } = setUp(t);
    fourShards(shards, (n) =>
      n === 2 ? [spec("skips unannounced", "skipped")] : []
    );
    const known = writeKnownSkips(dir, []);
    assert.deepEqual(check(dir, known), {
      ok: false,
      lines: [
        "chromium shards reported: 1 2 3 4 of 4",
        `::error title=unexpected e2e skip::[chromium] skips unannounced -- not in ${known}`,
      ],
    });
  });

  it("a missing known-skips file is an error", (t) => {
    const { dir, shards } = setUp(t);
    fourShards(shards);
    const known = path.join(dir, "known-skips.txt");
    assert.deepEqual(check(dir, known), {
      ok: false,
      lines: [
        "chromium shards reported: 1 2 3 4 of 4",
        `::error::${known} not checked out -- the sparse-checkout path in this job is stale`,
      ],
    });
  });

  it("comments and blank lines in the known list are not titles", (t) => {
    const { dir, shards } = setUp(t);
    fourShards(shards, (n) =>
      n === 1 ? [spec("still skips", "skipped")] : []
    );
    const known = writeKnownSkips(dir, [
      "# why each one skips is in the test",
      "",
      "still skips",
    ]);
    assert.deepEqual(check(dir, known), {
      ok: true,
      lines: ["chromium shards reported: 1 2 3 4 of 4"],
    });
  });

  it("checks the shards of each project on its own", (t) => {
    const { dir, shards } = setUp(t);
    writeProjectShards(shards, "chromium", { current: [1, 2], total: 2 });
    writeProjectShards(shards, "firefox", { current: [1, 2], total: 2 });
    const known = writeKnownSkips(dir, []);
    assert.deepEqual(checkBoth(dir, known), {
      ok: true,
      lines: [
        "chromium shards reported: 1 2 of 2",
        "firefox shards reported: 1 2 of 2",
      ],
    });
  });

  it("a shard missing from one project is not filled by another's", (t) => {
    const { dir, shards } = setUp(t);
    writeProjectShards(shards, "chromium", { current: [1, 2], total: 2 });
    writeProjectShards(shards, "firefox", { current: [1], total: 2 });
    const known = writeKnownSkips(dir, []);
    assert.deepEqual(checkBoth(dir, known), {
      ok: false,
      lines: [
        "::error::firefox shards 1 of 2 reported -- every one of 1..2 must",
      ],
    });
  });

  it("an expected project without a report is an error", (t) => {
    const { dir, shards } = setUp(t);
    writeProjectShards(shards, "chromium", { current: [1, 2], total: 2 });
    const known = writeKnownSkips(dir, []);
    assert.deepEqual(checkBoth(dir, known), {
      ok: false,
      lines: [
        "::error::no firefox report -- the run expected chromium, firefox",
      ],
    });
  });

  it("a report of a project the run did not expect is an error", (t) => {
    const { dir, shards } = setUp(t);
    writeProjectShards(shards, "chromium", { current: [1, 2], total: 2 });
    writeProjectShards(shards, "firefox", { current: [1, 2], total: 2 });
    const known = writeKnownSkips(dir, []);
    assert.deepEqual(check(dir, known), {
      ok: false,
      lines: ["::error::a firefox report -- the run expected only chromium"],
    });
  });

  it("a known-skips prefix that names no project is an error", (t) => {
    const { dir, shards } = setUp(t);
    fourShards(shards);
    const known = writeKnownSkips(dir, ["[firfox] skips"]);
    assert.deepEqual(check(dir, known), {
      ok: false,
      lines: [
        "chromium shards reported: 1 2 3 4 of 4",
        `::error title=unknown project in known skips::[firfox] skips -- ${known} names [firfox], none of chromium, firefox`,
      ],
    });
  });

  it("a report holding tests of two projects is an error naming the file", (t) => {
    const { dir, shards } = setUp(t);
    const mixed = writeShard(
      shards,
      1,
      report({
        current: 1,
        total: 1,
        specs: [specOn("firefox")("runs here too", "expected")],
      })
    );
    const known = writeKnownSkips(dir, []);
    assert.deepEqual(check(dir, known), {
      ok: false,
      lines: [
        `::error::${mixed} ran projects [chromium, firefox] -- a shard runs exactly one`,
      ],
    });
  });

  // The test `skips` ends with `status` on `skippedOn`, the one project the
  // run expects and holds, against the one known-skips line `entry`.
  const prefixCases = [
    {
      name: "a [firefox] line covers the skip on firefox",
      entry: "[firefox] skips",
      skippedOn: "firefox",
      status: "skipped",
      ok: true,
      lines: [],
    },
    {
      name: "a [firefox] line neither covers the title on chromium nor goes stale without firefox",
      entry: "[firefox] skips",
      skippedOn: "chromium",
      status: "skipped",
      ok: false,
      lines: [
        "::error title=unexpected e2e skip::[chromium] skips -- not in KNOWN",
      ],
    },
    {
      name: "a [firefox] line goes stale when firefox ran the test",
      entry: "[firefox] skips",
      skippedOn: "firefox",
      status: "expected",
      ok: true,
      lines: [
        "::warning title=stale known skip::[firefox] skips -- listed in KNOWN but ran",
      ],
    },
    {
      name: "a line without a prefix covers the skip on any project",
      entry: "skips",
      skippedOn: "firefox",
      status: "skipped",
      ok: true,
      lines: [],
    },
  ];
  for (const { name, entry, skippedOn, status, ok, lines } of prefixCases) {
    it(name, (t) => {
      const { dir, shards } = setUp(t);
      writeShard(
        shards,
        1,
        reportOn(skippedOn)({
          current: 1,
          total: 1,
          specs: [specOn(skippedOn)("skips", status)],
        })
      );
      const known = writeKnownSkips(dir, [entry]);
      assert.deepEqual(checkFor([skippedOn])(dir, known), {
        ok,
        lines: [`${skippedOn} shards reported: 1 of 1`].concat(
          lines.map((line) => line.replace("KNOWN", known))
        ),
      });
    });
  }
});
