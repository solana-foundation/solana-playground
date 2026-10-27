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

const spec = (title, status) => ({ title, tests: [{ status }] });

// The describe nesting of a real report: a file suite holding a describe
// suite holding the specs.
const report = ({ current, total, specs }) => ({
  config: { shard: { current, total } },
  suites: [
    {
      title: "a.e2e.spec.ts",
      suites: [{ title: "a describe", specs }],
    },
  ],
});

const shardFile = (dir, n) =>
  path.join(dir, `playwright-test-results-${n}`, "report.json");

const writeShard = (dir, n, content) => {
  const file = shardFile(dir, n);
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

const check = (dir, knownSkipsFile) =>
  checkReports({ reportsDir: path.join(dir, "shards"), knownSkipsFile });

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
        "shards reported: 1 2 3 4 of 4",
        `::warning title=stale known skip::ran after all -- listed in ${known} but ran`,
        "::warning title=flaky e2e test::passed on retry -- failed once on this runner, passed on retry; its trace is in the shard's artifact",
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
      lines: ["::error::shards 1 2 4 of 4 reported -- every one of 1..4 must"],
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
      lines: ["::error::the shards disagree on their total: 2 4"],
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
        "shards reported: 1 2 3 4 of 4",
        `::error title=unexpected e2e skip::skips unannounced -- not in ${known}`,
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
        "shards reported: 1 2 3 4 of 4",
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
      lines: ["shards reported: 1 2 3 4 of 4"],
    });
  });
});
