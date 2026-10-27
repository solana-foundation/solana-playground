// The `e2e-report` job of client-v2.yml: one pass over every shard's
// Playwright json report. A skipped test is green to Playwright, and so is
// one that passed on its retry; its reporters name neither, so both are read
// from the json here. One pass over the union of the reports, not one per
// shard: a per-shard check would warn "stale known skip" from every shard
// that does not hold the listed test. A shard whose report is missing is a
// slice nobody checked, so the reports must cover exactly 1..total before any
// title is read. Every finding is a GitHub annotation (`::error::`,
// `::warning::`); the exit code is 1 on any error.
//
// Usage: node scripts/e2e-report.mjs <reports dir> <known-skips file>
// Reports are `<reports dir>/*/report.json`, one directory per shard.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ascending = (a, b) => a - b;

// `#` comments and blank lines are not titles.
const parseKnownSkips = (text) =>
  text.split("\n").filter((line) => line !== "" && !line.startsWith("#"));

// Every object in the report with a `tests` array is a spec, wherever the
// describe nesting put it.
const specsOf = (node) => {
  if (Array.isArray(node)) return node.flatMap(specsOf);
  if (node === null || typeof node !== "object") return [];
  const nested = Object.values(node).flatMap(specsOf);
  return Array.isArray(node.tests) ? [node, ...nested] : nested;
};

const titlesWithStatus = (reports, status) =>
  new Set(
    reports
      .flatMap(specsOf)
      .filter((spec) => spec.tests.some((test) => test.status === status))
      .map((spec) => spec.title)
  );

const reportFiles = (dir) => {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    // No directory is the same answer as an empty one: no shard reported.
    if (error.code !== "ENOENT") throw error;
    entries = [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name, "report.json"))
    .filter((file) => fs.existsSync(file))
    .sort();
};

// Playwright writes `config.shard` as `{ total, current }`, and `null` for a
// run without `--shard`.
const parseReports = (files) => {
  const reports = [];
  const errors = [];
  for (const file of files) {
    let report;
    try {
      report = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      errors.push(
        `::error::${file} is not JSON -- the upload is truncated or the run died mid-write`
      );
      continue;
    }
    const shard = report?.config?.shard;
    if (shard === null || typeof shard !== "object") {
      errors.push(
        `::error::${file} has no config.shard -- the run was not sharded`
      );
      continue;
    }
    reports.push({ shard, report });
  }
  return { reports, errors };
};

// A cancelled shard, a shard that never reached a report, or a lost upload
// is a slice nobody checked, not a pass.
const checkShards = (shards) => {
  const totals = [...new Set(shards.map((shard) => shard.total))].sort(
    ascending
  );
  if (totals.length !== 1) {
    return {
      ok: false,
      line: `::error::the shards disagree on their total: ${totals.join(" ")}`,
    };
  }
  const [total] = totals;
  const current = shards
    .map((shard) => shard.current)
    .sort(ascending)
    .join(" ");
  const every = Array.from({ length: total }, (_, i) => i + 1).join(" ");
  if (current !== every) {
    return {
      ok: false,
      line: `::error::shards ${current} of ${total} reported -- every one of 1..${total} must`,
    };
  }
  return { ok: true, line: `shards reported: ${current} of ${total}` };
};

/**
 * The job's verdict: `lines` are its stdout, `ok` is false on any `::error`.
 * A skip outside the known-skips list is an error; a listed title that did
 * not skip and a flaky title are warnings, since both are work to do.
 *
 * @param {{ reportsDir: string, knownSkipsFile: string }} options
 * @returns {{ ok: boolean, lines: string[] }}
 */
export const checkReports = ({ reportsDir, knownSkipsFile }) => {
  const files = reportFiles(reportsDir);
  if (files.length === 0) {
    const glob = path.join(reportsDir, "*", "report.json");
    return {
      ok: false,
      lines: [`::error::no ${glob} -- no shard ran to a report`],
    };
  }
  const { reports, errors } = parseReports(files);
  if (errors.length > 0) return { ok: false, lines: errors };
  const shards = checkShards(reports.map(({ shard }) => shard));
  if (!shards.ok) return { ok: false, lines: [shards.line] };
  if (!fs.existsSync(knownSkipsFile)) {
    return {
      ok: false,
      lines: [
        shards.line,
        `::error::${knownSkipsFile} not checked out -- the sparse-checkout path in this job is stale`,
      ],
    };
  }
  const known = new Set(
    parseKnownSkips(fs.readFileSync(knownSkipsFile, "utf8"))
  );
  const jsons = reports.map(({ report }) => report);
  const skipped = titlesWithStatus(jsons, "skipped");
  const flaky = titlesWithStatus(jsons, "flaky");
  const unexpected = [...skipped].filter((title) => !known.has(title)).sort();
  const stale = [...known].filter((title) => !skipped.has(title)).sort();
  return {
    ok: unexpected.length === 0,
    lines: [
      shards.line,
      ...unexpected.map(
        (title) =>
          `::error title=unexpected e2e skip::${title} -- not in ${knownSkipsFile}`
      ),
      ...stale.map(
        (title) =>
          `::warning title=stale known skip::${title} -- listed in ${knownSkipsFile} but ran`
      ),
      ...[...flaky]
        .sort()
        .map(
          (title) =>
            `::warning title=flaky e2e test::${title} -- failed once on this runner, passed on retry; its trace is in the shard's artifact`
        ),
    ],
  };
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [reportsDir, knownSkipsFile] = process.argv.slice(2);
  if (reportsDir === undefined || knownSkipsFile === undefined) {
    console.error(
      "usage: node scripts/e2e-report.mjs <reports dir> <known-skips file>"
    );
    process.exit(1);
  }
  const { ok, lines } = checkReports({ reportsDir, knownSkipsFile });
  for (const line of lines) console.log(line);
  process.exitCode = ok ? 0 : 1;
}
