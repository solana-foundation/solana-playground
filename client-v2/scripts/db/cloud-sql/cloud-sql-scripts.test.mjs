// Runs create-preview-db and sweep-preview-dbs against stub `psql`,
// `pg_dump`, `cloud-sql-proxy` and `gcloud` on PATH. The stub psql answers
// from a scripted state and logs every statement it receives, so each test
// asserts on what reached the instance.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// STUB_STATE: the database comment `state()` reads; STUB_STATE_FAIL makes
// that lookup fail. STUB_ROWS: list-preview-dbs's rows. STUB_DROP_FAIL: a
// database whose drop fails.
const PSQL = `#!/usr/bin/env bash
sql=
while [ "$#" -gt 0 ]; do
  if [ "$1" = -c ]; then sql=$2; shift; fi
  shift
done
if [ -z "$sql" ]; then
  cat >/dev/null
  echo "COPY" >> "$STUB_LOG"
  exit 0
fi
printf '%s\\n' "$sql" >> "$STUB_LOG"
case "$sql" in
  *"where datname = "*)
    [ -z "\${STUB_STATE_FAIL:-}" ] || { echo "connection refused" >&2; exit 2; }
    printf '%s\\n' "\${STUB_STATE:-}" ;;
  *"where datname ~ "*) printf '%b' "\${STUB_ROWS:-}" ;;
  "drop database"*)
    if [ -n "\${STUB_DROP_FAIL:-}" ] && [[ "$sql" == *"\\"$STUB_DROP_FAIL\\""* ]]; then exit 1; fi ;;
esac
`;

const STUBS = {
  psql: PSQL,
  pg_dump: `#!/usr/bin/env bash\necho "PG_DUMP $*" >> "$STUB_LOG"\necho "-- dump"\n`,
  "cloud-sql-proxy": `#!/usr/bin/env bash\necho "ready for new connections"\nexec sleep 30\n`,
  gcloud: `#!/usr/bin/env bash\necho operator@example.com\n`,
};

let dir;
let log;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cloud-sql-stubs-"));
  log = join(dir, "log");
  writeFileSync(log, "");
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(dir, name), body);
    chmodSync(join(dir, name), 0o755);
  }
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const runWith = (env) => (script, args) =>
  spawnSync("bash", [join(HERE, script), ...args], {
    encoding: "utf8",
    // A case's variables override the defaults; assigned, not spread, as AGENTS.md asks of test fixtures
    env: Object.assign(
      {
        PATH: `${dir}:${process.env.PATH}`,
        HOME: process.env.HOME,
        CLOUD_SQL_INSTANCE: "proj:region:solpg-preview",
        CLOUD_SQL_USER: "app-user",
        CLOUD_SQL_LOGIN_USER: "ci@proj.iam.gserviceaccount.com",
        CLOUD_SQL_PROXY_PORT: "5499",
        STUB_LOG: log,
      },
      env
    ),
  });

const readLog = () => readFileSync(log, "utf8");
const DB = "solpg_preview_pr_7";

describe("cloud-sql/create-preview-db", () => {
  const create = (env) => runWith(env)("create-preview-db", ["--pr", "7"]);

  it("reuses a database whose copy finished", () => {
    const run = create({ STUB_STATE: "created-at:1700000000" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stderr, /reusing database solpg_preview_pr_7/);
    assert.doesNotMatch(readLog(), /drop database/);
    assert.doesNotMatch(readLog(), /COPY|PG_DUMP/);
    assert.match(run.stdout, /^CLOUD_SQL_DATABASE=solpg_preview_pr_7$/m);
  });

  it("drops and recopies a database left mid-copy", () => {
    const run = create({ STUB_STATE: "copying:1700000000" });
    assert.equal(run.status, 0, run.stderr);
    const lines = readLog().split("\n");
    const drop = lines.indexOf(`drop database if exists "${DB}" with (force)`);
    const createAt = lines.indexOf(`create database "${DB}" owner "app-user"`);
    assert.ok(drop >= 0, readLog());
    assert.ok(createAt > drop, readLog());
    assert.match(readLog(), /PG_DUMP .*solpg_preview\?/);
    assert.match(
      readLog(),
      /COPY\ncomment on database "solpg_preview_pr_7" is 'created-at:\d+'/
    );
  });

  it("creates an absent database", () => {
    const run = create({ STUB_STATE: "" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stderr, /created database solpg_preview_pr_7/);
    assert.match(
      readLog(),
      /comment on database "solpg_preview_pr_7" is 'copying:\d+'/
    );
    assert.match(readLog(), /COPY/);
  });

  it("fails without a drop when the lookup fails", () => {
    const run = create({ STUB_STATE_FAIL: "1" });
    assert.notEqual(run.status, 0);
    assert.doesNotMatch(readLog(), /drop database|create database|COPY/);
    assert.equal(run.stdout, "");
  });
});

describe("cloud-sql/sweep-preview-dbs", () => {
  const minutesAgo = (minutes) => Math.floor(Date.now() / 1000) - minutes * 60;
  // 1 labelled, 2 old, 3 young, 4 unstamped, 5 old with a failing drop
  const rows = [
    `solpg_preview_pr_1|${minutesAgo(600)}`,
    `solpg_preview_pr_2|${minutesAgo(600)}`,
    `solpg_preview_pr_3|${minutesAgo(5)}`,
    "solpg_preview_pr_4|",
    `solpg_preview_pr_5|${minutesAgo(600)}`,
  ].join("\\n");

  const sweep = (env) => {
    const prs = join(dir, "prs.json");
    writeFileSync(
      prs,
      JSON.stringify([
        { number: 1, headRefName: "a", labels: [{ name: "preview" }] },
        { number: 2, headRefName: "b", labels: [{ name: "other" }] },
      ])
    );
    return runWith(
      Object.assign(
        { PREVIEW_LABEL: "preview", MIN_AGE_MINUTES: "60", STUB_ROWS: rows },
        env
      )
    )("sweep-preview-dbs", [prs]);
  };
  const drops = () =>
    readLog()
      .split("\n")
      .filter((line) => line.startsWith("drop database"));

  it("drops only old, unlabelled, stamped databases and counts a failed drop", () => {
    const run = sweep({
      DRY_RUN: "false",
      STUB_DROP_FAIL: "solpg_preview_pr_5",
    });
    assert.equal(run.status, 1, run.stderr);
    assert.deepEqual(drops(), [
      'drop database if exists "solpg_preview_pr_2" with (force)',
      'drop database if exists "solpg_preview_pr_5" with (force)',
    ]);
    assert.match(run.stdout, /::warning::could not drop solpg_preview_pr_5/);
    assert.match(
      run.stdout,
      /Dropped 1 preview databases, kept 3, failed 1; 5 PR databases on the instance before the sweep\./
    );
  });

  it("drops nothing on a dry run", () => {
    const run = sweep({ DRY_RUN: "true" });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(drops(), []);
    assert.match(run.stdout, /would drop solpg_preview_pr_2 \(age 600m\)/);
    assert.match(
      run.stdout,
      /Would drop 2 preview databases, kept 3, failed 0/
    );
  });
});
