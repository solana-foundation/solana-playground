// The `e2e-report` job of client-v2.yml: one pass over every shard's
// Playwright json report. A skipped test is green to Playwright, and so is
// one that passed on its retry; its reporters name neither, so both are read
// from the json here. One pass over the union of the reports, not one per
// shard: a per-shard check would warn "stale known skip" from every shard
// that does not hold the listed test. A shard whose report is missing is a
// slice nobody checked, so the reports must hold exactly the projects the run
// expected, and each project's must cover 1..total, before any title is read.
// Every finding is a GitHub annotation (`::error::`, `::warning::`); the exit
// code is 1 on any error.
//
// Usage: E2E_PROJECTS=chromium,firefox node scripts/e2e-report.mjs <reports dir> <known-skips file>
// Reports are `<reports dir>/*/report.json`, one directory per shard.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PROJECTS } from "./e2e-projects.mjs";

const ascending = (a, b) => a - b;

const KNOWN_SKIP = /^\[([^\]]+)\] (.+)$/;

// `#` comments and blank lines are not titles. `[<project>] <title>` holds
// for that project alone; a bare title holds for every project.
const parseKnownSkips = (text) =>
  text
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const match = KNOWN_SKIP.exec(line);
      return match === null
        ? { line, project: undefined, title: line }
        : { line, project: match[1], title: match[2] };
    });

// Every object in the report with a `tests` array is a spec, wherever the
// describe nesting put it.
const specsOf = (node) => {
  if (Array.isArray(node)) return node.flatMap(specsOf);
  if (node === null || typeof node !== "object") return [];
  const nested = Object.values(node).flatMap(specsOf);
  return Array.isArray(node.tests) ? [node, ...nested] : nested;
};

const labelOf = ({ project, title }) => `[${project}] ${title}`;

// One entry per project and title: a spec runs once per project.
const testsWithStatus = (reports, status) => {
  const found = new Map();
  for (const spec of reports.flatMap(specsOf)) {
    for (const test of spec.tests) {
      if (test.status !== status) continue;
      const entry = { project: test.projectName, title: spec.title };
      found.set(labelOf(entry), entry);
    }
  }
  return [...found.values()];
};

const isKnownSkip = (entry, skip) =>
  entry.title === skip.title &&
  (entry.project === undefined || entry.project === skip.project);

// The project a shard ran is read from its tests: `config.projects` lists
// every project of the config, whichever `--project` picked.
const projectsOf = (report) =>
  [
    ...new Set(
      specsOf(report.suites ?? []).flatMap((spec) =>
        spec.tests.map((test) => test.projectName)
      )
    ),
  ].sort();

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
    const projects = projectsOf(report);
    if (projects.length !== 1) {
      errors.push(
        `::error::${file} ran projects [${projects.join(
          ", "
        )}] -- a shard runs exactly one`
      );
      continue;
    }
    reports.push({ shard, project: projects[0], report });
  }
  return { reports, errors };
};

// A cancelled shard, a shard that never reached a report, or a lost upload
// is a slice nobody checked, not a pass. Each project is sharded on its own.
const checkShards = (project, shards) => {
  const totals = [...new Set(shards.map((shard) => shard.total))].sort(
    ascending
  );
  if (totals.length !== 1) {
    return {
      ok: false,
      line: `::error::the ${project} shards disagree on their total: ${totals.join(
        " "
      )}`,
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
      line: `::error::${project} shards ${current} of ${total} reported -- every one of 1..${total} must`,
    };
  }
  return {
    ok: true,
    line: `${project} shards reported: ${current} of ${total}`,
  };
};

// Inferring the projects from the reports would pass a run whose every Firefox upload was lost.
const checkProjects = (expected, reports) => {
  const ran = [...new Set(reports.map(({ project }) => project))].sort();
  const names = expected.join(", ");
  return [
    ...expected
      .filter((project) => !ran.includes(project))
      .map(
        (project) =>
          `::error::no ${project} report -- the run expected ${names}`
      ),
    ...ran
      .filter((project) => !expected.includes(project))
      .map(
        (project) =>
          `::error::a ${project} report -- the run expected only ${names}`
      ),
  ];
};

// A misspelt prefix would match nothing and never go stale.
const unknownPrefixes = (known, knownSkipsFile) =>
  known
    .filter(
      ({ project }) => project !== undefined && !PROJECTS.includes(project)
    )
    .map(
      ({ line, project }) =>
        `::error title=unknown project in known skips::${line} -- ${knownSkipsFile} names [${project}], none of ${PROJECTS.join(
          ", "
        )}`
    );

/**
 * The job's verdict: `lines` are its stdout, `ok` is false on any `::error`.
 * A skip outside the known-skips list is an error; a listed title that did
 * not skip and a flaky title are warnings, since both are work to do.
 *
 * @param {{ reportsDir: string, knownSkipsFile: string, expectedProjects: string[] }} options
 * @returns {{ ok: boolean, lines: string[] }}
 */
export const checkReports = ({
  reportsDir,
  knownSkipsFile,
  expectedProjects,
}) => {
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
  const projectErrors = checkProjects(expectedProjects, reports);
  if (projectErrors.length > 0) return { ok: false, lines: projectErrors };
  const shards = expectedProjects.map((project) =>
    checkShards(
      project,
      reports
        .filter((report) => report.project === project)
        .map(({ shard }) => shard)
    )
  );
  if (shards.some((check) => !check.ok)) {
    return {
      ok: false,
      lines: shards.filter((check) => !check.ok).map((check) => check.line),
    };
  }
  const shardLines = shards.map((check) => check.line);
  if (!fs.existsSync(knownSkipsFile)) {
    return {
      ok: false,
      lines: [
        ...shardLines,
        `::error::${knownSkipsFile} not checked out -- the sparse-checkout path in this job is stale`,
      ],
    };
  }
  const known = parseKnownSkips(fs.readFileSync(knownSkipsFile, "utf8"));
  const prefixErrors = unknownPrefixes(known, knownSkipsFile);
  const jsons = reports.map(({ report }) => report);
  const skipped = testsWithStatus(jsons, "skipped");
  const flaky = testsWithStatus(jsons, "flaky");
  const unexpected = skipped
    .filter((skip) => !known.some((entry) => isKnownSkip(entry, skip)))
    .map(labelOf)
    .sort();
  // A line for a project this run left out has nothing to be stale against.
  const stale = known
    .filter(
      (entry) =>
        entry.project === undefined || expectedProjects.includes(entry.project)
    )
    .filter((entry) => !skipped.some((skip) => isKnownSkip(entry, skip)))
    .map(({ line }) => line)
    .sort();
  return {
    ok: unexpected.length === 0 && prefixErrors.length === 0,
    lines: [
      ...shardLines,
      ...prefixErrors,
      ...unexpected.map(
        (label) =>
          `::error title=unexpected e2e skip::${label} -- not in ${knownSkipsFile}`
      ),
      ...stale.map(
        (line) =>
          `::warning title=stale known skip::${line} -- listed in ${knownSkipsFile} but ran`
      ),
      ...flaky
        .map(labelOf)
        .sort()
        .map(
          (label) =>
            `::warning title=flaky e2e test::${label} -- failed once on this runner, passed on retry; its trace is in the shard's artifact`
        ),
    ],
  };
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [reportsDir, knownSkipsFile] = process.argv.slice(2);
  const expectedProjects = (process.env.E2E_PROJECTS ?? "")
    .split(",")
    .filter((name) => name !== "");
  if (
    reportsDir === undefined ||
    knownSkipsFile === undefined ||
    expectedProjects.length === 0
  ) {
    console.error(
      "usage: E2E_PROJECTS=<project>[,<project>...] node scripts/e2e-report.mjs <reports dir> <known-skips file>"
    );
    process.exit(1);
  }
  const { ok, lines } = checkReports({
    reportsDir,
    knownSkipsFile,
    expectedProjects,
  });
  for (const line of lines) console.log(line);
  process.exitCode = ok ? 0 : 1;
}
