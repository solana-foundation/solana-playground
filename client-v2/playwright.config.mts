import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import {
  DevServerRefusal,
  decideDevServer,
} from "./scripts/dev-server-owner.mjs";
import {
  DEFAULT_MAX_RUNS,
  acquireSlot,
  describeHolders,
} from "./scripts/e2e-queue.mjs";

// `craco start` binds `PORT`, so the same variable picks the server the run
// uses. Locally, give each worktree its own (docs/testing.md section 8).
const port = Number(process.env.PORT ?? 3000);
if (!(Number.isInteger(port) && port > 0 && port < 65536)) {
  console.error(
    `PORT must be an integer from 1 to 65535, got "${process.env.PORT}".`
  );
  process.exit(1);
}
const origin = `http://localhost:${port}`;

const positiveIntegerFromEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name] ?? fallback);
  if (!(Number.isInteger(value) && value > 0)) {
    console.error(
      `${name} must be a positive integer, got "${process.env[name]}".`
    );
    process.exit(1);
  }
  return value;
};

// Two Chromiums beside the dev server fit a laptop that other worktrees also
// load; Playwright's default is half the cores. CI leaves `workers` unset.
const workers = process.env.CI
  ? undefined
  : positiveIntegerFromEnv("E2E_WORKERS", 2);

// Several worktrees running the suite at once swapped the machine (HOO-2106),
// so a local run waits for a machine-wide slot before it starts its dev
// server. `--list` never takes one. The runner's first evaluation does and
// leaves a marker in the environment, so workers, which evaluate this config
// again, skip the queue.
const QUEUE_SLOT_ENV = "E2E_QUEUE_SLOT";

const takeQueueSlot = () => {
  // `--list`, `--list=...` and the short `-l` only print test titles.
  const listing = process.argv.some(
    (arg) => arg === "-l" || arg.startsWith("--list")
  );
  if (process.env.CI || listing) return;
  if (process.env[QUEUE_SLOT_ENV]) return;
  const max = positiveIntegerFromEnv("E2E_MAX_RUNS", DEFAULT_MAX_RUNS);
  const dir =
    process.env.E2E_QUEUE_DIR ??
    path.join(os.homedir(), ".cache", "solana-playground-e2e");
  const slot = acquireSlot({
    dir,
    max,
    owner: { pid: process.pid, worktree: import.meta.dirname, port },
    onWait: (holders) => console.error(describeHolders(holders, max)),
  });
  process.env[QUEUE_SLOT_ENV] = String(slot.slot);
  console.error(`e2e queue: got slot ${slot.slot}`);
  process.on("exit", slot.release);
  // Release first, then let the signal take its usual course: our listener
  // is removed, so the re-raised signal ends the process as it would have.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const onSignal = () => {
      slot.release();
      process.off(signal, onSignal);
      process.kill(process.pid, signal);
    };
    process.on(signal, onSignal);
  }
};
takeQueueSlot();

// Playwright evaluates this config again in every worker, where our own dev
// server is already up. The runner's first evaluation probes the port and
// leaves the decision here, so workers read it instead of probing again.
const DEV_SERVER_DECISION_ENV = "E2E_DEV_SERVER";

const devServerDecision = (): "start" | "reuse" => {
  if (process.env.CI) return "start";
  const cached = process.env[DEV_SERVER_DECISION_ENV];
  if (cached === "start" || cached === "reuse") return cached;
  try {
    const decision = decideDevServer({ port, root: import.meta.dirname });
    process.env[DEV_SERVER_DECISION_ENV] = decision;
    return decision;
  } catch (error) {
    if (!(error instanceof DevServerRefusal)) throw error;
    // The message is the whole answer; a stack trace would bury it. Exiting
    // here stops the run before any test.
    console.error(error.message);
    process.exit(1);
  }
};
const decision = devServerDecision();

/**
 * Browser-level tests. Kept out of `src` so vitest never collects them -
 * its `include` would otherwise try to run `.spec.ts` files under a runner
 * that has no browser.
 */
export default defineConfig({
  testDir: "./e2e",
  // The dev server is slow to boot: wasm chunks plus the generate step
  //
  // Per test. 30s was under what the slowest specs actually need: the
  // migration ones seed a config, reload, and wait for a whole workspace to
  // come back, and measure 38-47s on their own. They passed only when the
  // machine was otherwise idle, so the suite failed in a different place on
  // each sequential run -- which reads as flakiness and trains you to ignore
  // it. Raised to cover them with room, since a genuine hang still fails,
  // just a minute later. Override either way - tighter to catch a stall
  // sooner, looser when slowMo paces the run:
  //   E2E_TIMEOUT=15000 yarn test-e2e
  //   SLOWMO=800 E2E_TIMEOUT=120000 yarn test-e2e --headed
  timeout: Number(process.env.E2E_TIMEOUT ?? 60_000),
  // Deliberately well under the test timeout, so an assertion that will never
  // pass fails naming its locator rather than as a bare "test timeout". 10s
  // was not enough for the first assertion in a spec: that one waits on the
  // explorer's async init, which on a loaded machine running the suite
  // sequentially takes longer than everything that follows it.
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers,
  // One retry in CI, none locally. The runner is three times slower than a
  // laptop and reorders what lands first, so a spec can fail there on timing
  // alone; red on every such run would block unrelated PRs and train people
  // to ignore the job. A pass on the retry is not a pass: Playwright reports
  // it as "flaky", the trace of the failed attempt is kept, and the job's
  // count step names it in the annotations as work to do. Locally a flake
  // fails outright, which is where it gets fixed. Quarantine is still an
  // explicit `test.skip`/`test.fixme` with the reason, never a retry.
  retries: process.env.CI ? 1 : 0,
  // `github` turns each failure into a PR annotation (Checks tab, inline
  // when the line is in the diff); `list` is the log a reviewer reads in
  // the job output; `json` is what the job's skip-count step reads, since
  // neither of the other two prints a skip's reason.
  reporter: process.env.CI
    ? [
        ["list"],
        ["github"],
        ["json", { outputFile: "test-results/report.json" }],
      ]
    : "line",
  // Under the job's 30-minute limit, so Playwright itself ends a hung run
  // and still prints its summary; a GitHub cancel keeps the traces but not
  // the line saying which test was running.
  globalTimeout: process.env.CI ? 25 * 60_000 : 0,
  use: {
    baseURL: origin,
    // Every failed attempt keeps its trace, a flaky test's first attempt
    // included; CI uploads them as the job's artifact, and locally
    // `yarn playwright show-trace test-results/<test>/trace.zip` opens one.
    trace: "retain-on-failure",
    // Without this, an action inherits the whole test timeout and reports a
    // bare "test timeout" - naming no locator. Fail fast and say which one.
    actionTimeout: 10_000,
    // Watch the flow at human speed: SLOWMO=600 yarn test-e2e --headed
    launchOptions: { slowMo: Number(process.env.SLOWMO ?? 0) },
  },
  webServer: {
    // `dev` runs `generate-fast`: still syncs public/, but skips
    // `generate-crates`, which shells out to cargo and dominates the runtime
    command: "yarn dev",
    url: origin,
    // Only this worktree's own dev server is reused. Any other server on the
    // port fails the run in `decideDevServer` (HOO-2106: a run reused another
    // worktree's server on :3000 and reported false passes). CI always starts
    // its own.
    reuseExistingServer: decision === "reuse",
    // A minute on a laptop; a 2-vCPU runner compiles the same bundle several
    // times slower, and a boot that times out fails the whole job for nothing
    timeout: process.env.CI ? 600_000 : 300_000,
    // CRA prints "Failed to compile" to stdout, which Playwright drops by
    // default. A broken bundle still serves index.html, so without this
    // every test fails at its first locator with the cause nowhere in the
    // job log.
    stdout: process.env.CI ? "pipe" : "ignore",
    stderr: "pipe",
    env: { BROWSER: "none", PORT: String(port) },
  },
});
